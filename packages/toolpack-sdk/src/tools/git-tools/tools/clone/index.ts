import { ToolDefinition, ToolContext } from '../../../types.js';
import type { GithubTokenStore } from '../../../github-tools/auth.js';
import { gitCloneSchema } from './schema.js';
import { getGit } from '../../utils.js';
import { resolveGithubToken } from '../../../github-tools/auth.js';
import { CloneState, defaultCloneState } from './clone-state.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const DEFAULT_CLONE_ROOT = '.toolpack/clones';
const DEFAULT_MAX_BYTES  = 5_000_000_000; // 5 GB


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

async function performClone(
    state: CloneState,
    repo: string,
    sha: string,
    filter: string,
    depth: number,
    cloneRoot: string,
    tokenStore?: GithubTokenStore,
): Promise<string> {
    const authToken = await resolveGithubToken(repo, undefined, tokenStore);
    const cloneUrl = `https://x-access-token:${authToken}@github.com/${repo}.git`;
    const repoSlug = repo.replace('/', '_');
    const cloneDir = path.resolve(cloneRoot, repoSlug);
    const git = getGit(cloneRoot);

    const existing = state.registry.get(repo);
    if (existing) {
        try {
            await fs.access(cloneDir);
            if (existing.sha === sha) {
                existing.lastAccessedAt = Date.now();
                return cloneDir;
            }
            await fs.rm(cloneDir, { recursive: true, force: true });
            state.totalBytes = Math.max(0, state.totalBytes - existing.sizeBytes);
            state.registry.delete(repo);
        } catch {
            state.totalBytes = Math.max(0, state.totalBytes - existing.sizeBytes);
            state.registry.delete(repo);
        }
    } else {
        try {
            await fs.access(cloneDir);
            await fs.rm(cloneDir, { recursive: true, force: true });
        } catch { /* directory doesn't exist — good */ }
    }

    const cloneOptions: string[] = ['--no-checkout'];
    if (depth > 0) cloneOptions.push('--depth', depth.toString());
    if (filter && filter !== 'none') cloneOptions.push('--filter', filter);

    try {
        await git.clone(cloneUrl, repoSlug, cloneOptions);
        const repoGit = getGit(cloneDir);
        try {
            const fetchArgs = ['origin', sha];
            if (depth > 0) fetchArgs.push('--depth', depth.toString());
            await repoGit.fetch(fetchArgs);
        } catch { /* SHA already present from initial clone */ }
        await repoGit.checkout(['--force', sha]);

        const sizeBytes = await getDirectorySize(cloneDir);
        state.totalBytes += sizeBytes;
        state.registry.set(repo, { cloneDir, repo, sha, sizeBytes, lastAccessedAt: Date.now() });
        return cloneDir;
    } catch (error) {
        try { await fs.rm(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
        throw error;
    }
}

function redactTokenFromError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGitCloneTool(state: CloneState): ToolDefinition {
    return {
        name: 'git.clone',
        displayName: 'Git Clone',
        description: 'Clone a GitHub repository at a specific commit SHA for local inspection. Call this before using git.diff, git.blame, git.log, fs.*, or coding.* tools — those tools accept the returned cloneDir to operate locally instead of through the GitHub API. Repeated calls with the same repo+sha are instant (cached). Disk is managed automatically with LRU eviction.',
        category: 'version-control',
        parameters: gitCloneSchema,
        execute: async (args: Record<string, unknown>, ctx?: ToolContext) => {
            const repo = args.repo as string;
            const sha = args.sha as string;
            const filter = (args.filter as string) ?? 'blob:none';
            const depth = (args.depth as number) ?? 50;
            const gitCloneConfig = ctx?.config?.gitClone as { cloneRoot?: string; maxBytes?: number } | undefined;
            const cloneRoot = (args.cloneRoot as string)
                ?? gitCloneConfig?.cloneRoot
                ?? process.env.TOOLPACK_GIT_CLONE_ROOT
                ?? DEFAULT_CLONE_ROOT;
            const envMaxBytes = parseInt(process.env.TOOLPACK_GIT_CLONE_MAX_BYTES ?? '0', 10) || DEFAULT_MAX_BYTES;
            const maxBytes = gitCloneConfig?.maxBytes ?? envMaxBytes;

            if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
                return 'Error: repo must be in "owner/repo" format with alphanumeric, hyphens, underscores, or dots only (e.g., "microsoft/typescript")';
            }
            if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
                return 'Error: sha must be a valid commit SHA (7-40 hex characters)';
            }

            await fs.mkdir(cloneRoot, { recursive: true });
            const release = await state.acquireMutex(repo);

            try {
                const existing = state.registry.get(repo);
                if (existing && existing.sha === sha) {
                    existing.lastAccessedAt = Date.now();
                    return JSON.stringify({
                        cloneDir: existing.cloneDir,
                        next: 'Pass cloneDir to compatible git, filesystem, or coding tools to inspect this checkout.',
                    });
                }

                await state.evictIfNeeded(100_000_000, maxBytes);
                const cloneDir = await performClone(state, repo, sha, filter, depth, cloneRoot, ctx?.githubTokenStore);
                return JSON.stringify({
                    cloneDir,
                    next: 'Pass cloneDir to compatible git, filesystem, or coding tools to inspect this checkout.',
                });
            } catch (error: unknown) {
                return `Error cloning repository: ${redactTokenFromError(error)}`;
            } finally {
                release();
            }
        },
    };
}

// Backward-compat export using the module-level default state.
export const gitCloneTool: ToolDefinition = createGitCloneTool(defaultCloneState);
