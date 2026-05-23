import { ToolDefinition } from '../../../types.js';
import { gitCloneSchema } from './schema.js';
import { getGit } from '../../utils.js';
import { resolveGithubToken } from '../../../github-tools/auth.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_CLONE_ROOT = '.toolpack/clones';
const DEFAULT_MAX_BYTES = 5_000_000_000; // 5GB

// ── Types ───────────────────────────────────────────────────────────────────

interface CloneEntry {
    cloneDir: string;
    repo: string;
    sha: string;
    sizeBytes: number;
    lastAccessedAt: number;
}

// ── In-memory state (per-process) ─────────────────────────────────────────────

const cloneRegistry = new Map<string, CloneEntry>(); // repo -> entry
const repoMutexes = new Map<string, Promise<void>>(); // repo -> active operation
let currentTotalBytes = 0;

// ── Mutex utilities ────────────────────────────────────────────────────────────

async function acquireRepoMutex(repo: string): Promise<() => void> {
    while (repoMutexes.has(repo)) {
        await repoMutexes.get(repo);
    }

    let release: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    repoMutexes.set(repo, promise);

    return () => {
        repoMutexes.delete(repo);
        release!();
    };
}

// ── Directory size calculation ────────────────────────────────────────────────

async function getDirectorySize(dir: string): Promise<number> {
    let total = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await getDirectorySize(fullPath);
        } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            total += stats.size;
        }
    }
    return total;
}

// ── LRU Eviction ──────────────────────────────────────────────────────────────

async function evictIfNeeded(requiredBytes: number, maxBytes: number): Promise<void> {
    const targetSize = maxBytes - requiredBytes;

    while (currentTotalBytes > targetSize && cloneRegistry.size > 0) {
        // Find oldest entry (LRU)
        let oldest: CloneEntry | null = null;
        let oldestRepo: string | null = null;

        for (const [repo, entry] of cloneRegistry) {
            if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
                oldest = entry;
                oldestRepo = repo;
            }
        }

        if (!oldestRepo || !oldest) break;

        // Remove from disk
        try {
            await fs.rm(oldest.cloneDir, { recursive: true, force: true });
            currentTotalBytes = Math.max(0, currentTotalBytes - oldest.sizeBytes);
            cloneRegistry.delete(oldestRepo);
        } catch {
            // If we can't delete, stop trying to avoid infinite loop
            break;
        }
    }
}

// ── Main clone logic ──────────────────────────────────────────────────────────

async function performClone(
    repo: string,
    sha: string,
    filter: string,
    depth: number,
    cloneRoot: string,
): Promise<string> {
    // Resolve auth token via shared github-tools auth module (handles PAT, GitHub App, caching)
    const authToken = await resolveGithubToken(repo);

    // Construct clone URL with embedded token
    const cloneUrl = `https://x-access-token:${authToken}@github.com/${repo}.git`;

    // Create clone directory path
    const repoSlug = repo.replace('/', '_');
    const cloneDir = path.resolve(cloneRoot, repoSlug);

    const git = getGit(cloneRoot);

    // Check if already exists in registry and on disk
    const existing = cloneRegistry.get(repo);
    if (existing) {
        try {
            await fs.access(cloneDir);
            if (existing.sha === sha) {
                // Already at correct SHA - just update access time
                existing.lastAccessedAt = Date.now();
                return cloneDir;
            }
            // Different SHA - remove old clone and do fresh (updating SHAs in shallow clones is unreliable)
            await fs.rm(cloneDir, { recursive: true, force: true });
            currentTotalBytes = Math.max(0, currentTotalBytes - existing.sizeBytes);
            cloneRegistry.delete(repo);
        } catch {
            // Directory doesn't exist - remove stale registry entry
            currentTotalBytes = Math.max(0, currentTotalBytes - existing.sizeBytes);
            cloneRegistry.delete(repo);
        }
    } else {
        // Check for orphaned directory (not in registry but on disk)
        try {
            await fs.access(cloneDir);
            // Remove orphaned directory
            await fs.rm(cloneDir, { recursive: true, force: true });
        } catch {
            // Directory doesn't exist - good
        }
    }

    // Build clone options.
    // Omit --single-branch so all remote refs are advertised, making the
    // target SHA reachable regardless of which branch it lives on.
    const cloneOptions: string[] = ['--no-checkout'];

    if (depth > 0) {
        cloneOptions.push('--depth', depth.toString());
    }

    if (filter && filter !== 'none') {
        cloneOptions.push('--filter', filter);
    }

    // Clone
    try {
        await git.clone(cloneUrl, repoSlug, cloneOptions);

        const repoGit = getGit(cloneDir);

        // Fetch the specific SHA directly.
        // GitHub supports uploadpack.allowReachableSHA1InWant, so fetching
        // a bare SHA works as long as it's reachable from any ref.
        // Silently ignore failures — the SHA may already be present from the
        // initial clone (e.g. it's the tip of the default branch).
        try {
            const fetchArgs = ['origin', sha];
            if (depth > 0) fetchArgs.push('--depth', depth.toString());
            await repoGit.fetch(fetchArgs);
        } catch {
            // SHA already present from initial clone — proceed to checkout
        }

        // Checkout specific SHA
        await repoGit.checkout(['--force', sha]);

        // Calculate actual size and update registry
        const sizeBytes = await getDirectorySize(cloneDir);
        currentTotalBytes += sizeBytes;

        cloneRegistry.set(repo, {
            cloneDir,
            repo,
            sha,
            sizeBytes,
            lastAccessedAt: Date.now(),
        });

        return cloneDir;
    } catch (error) {
        // Cleanup on failure
        try {
            await fs.rm(cloneDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}

// Redact token from error messages for security
function redactTokenFromError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}

// ── Tool Definition ───────────────────────────────────────────────────────────

export const gitCloneTool: ToolDefinition = {
    name: 'git.clone',
    displayName: 'Git Clone',
    description: 'Clone a GitHub repository at a specific commit SHA for local inspection. Call this before using git.diff, git.blame, git.log, fs.*, or coding.* tools — those tools accept the returned cloneDir to operate locally instead of through the GitHub API. Repeated calls with the same repo+sha are instant (cached). Disk is managed automatically with LRU eviction.',
    category: 'version-control',
    parameters: gitCloneSchema,
    execute: async (args: Record<string, unknown>) => {
        const repo = args.repo as string;
        const sha = args.sha as string;
        const filter = (args.filter as string) ?? 'blob:none';
        const depth = (args.depth as number) ?? 50;
        const cloneRoot = (args.cloneRoot as string) ?? process.env.SENTINEL_CLONE_ROOT ?? DEFAULT_CLONE_ROOT;
        const maxBytes = parseInt(process.env.SENTINEL_CLONE_MAX_BYTES ?? '0', 10) || DEFAULT_MAX_BYTES;

        // Validate repo format - must be "owner/repo" with valid path characters
        const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
        if (!repoPattern.test(repo)) {
            return 'Error: repo must be in "owner/repo" format with alphanumeric, hyphens, underscores, or dots only (e.g., "microsoft/typescript")';
        }

        // Validate SHA format (basic check)
        if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
            return 'Error: sha must be a valid commit SHA (7-40 hex characters)';
        }

        // Ensure clone root exists
        await fs.mkdir(cloneRoot, { recursive: true });

        // Acquire mutex for this repo
        const release = await acquireRepoMutex(repo);

        try {
            // Check if we already have this exact clone
            const existing = cloneRegistry.get(repo);
            if (existing && existing.sha === sha) {
                existing.lastAccessedAt = Date.now();
                return JSON.stringify({
                    cloneDir: existing.cloneDir,
                    next: 'Pass cloneDir to compatible git, filesystem, or coding tools to inspect this checkout.',
                });
            }

            // Evict least-recently-used clones if needed to stay within cap.
            // Uses a conservative 100MB estimate for the incoming clone — actual
            // size is measured and recorded after the clone completes.
            await evictIfNeeded(100_000_000, maxBytes);

            const cloneDir = await performClone(repo, sha, filter, depth, cloneRoot);

            return JSON.stringify({
                cloneDir,
                next: 'Pass cloneDir to compatible git, filesystem, or coding tools to inspect this checkout.',
            });
        } catch (error: unknown) {
            const safeError = redactTokenFromError(error);
            return `Error cloning repository: ${safeError}`;
        } finally {
            release();
        }
    },
};
