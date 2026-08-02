import * as fs from 'fs/promises';

export interface CloneEntry {
    cloneDir: string;
    repo: string;
    sha: string;
    sizeBytes: number;
    lastAccessedAt: number;
}

/**
 * Shape for git.clone config passed via
 * `Toolpack.init({ toolsConfig: { additionalConfigurations: { gitClone: ... } } })`.
 * Programmatic values take priority over env vars.
 */
export interface CloneConfig {
    /** Root directory for git clones. Default: '.toolpack/clones'. Fallback env: TOOLPACK_GIT_CLONE_ROOT */
    cloneRoot?: string;
    /** Maximum total bytes across all clones before LRU eviction. Default: 5 GB. Fallback env: TOOLPACK_GIT_CLONE_MAX_BYTES */
    maxBytes?: number;
}

// Per-Toolpack-instance clone state. One instance is created by
// ToolRuntimeContext and closed over by the git.clone tool factory so
// concurrent tenants have isolated clone registries and disk quotas.
export class CloneState {
    readonly registry = new Map<string, CloneEntry>();
    readonly mutexes  = new Map<string, Promise<void>>();
    totalBytes = 0;

    async acquireMutex(repo: string): Promise<() => void> {
        while (this.mutexes.has(repo)) {
            await this.mutexes.get(repo);
        }
        let release!: () => void;
        const promise = new Promise<void>((resolve) => { release = resolve; });
        this.mutexes.set(repo, promise);
        return () => { this.mutexes.delete(repo); release(); };
    }

    async evictIfNeeded(requiredBytes: number, maxBytes: number): Promise<void> {
        const targetSize = maxBytes - requiredBytes;
        while (this.totalBytes > targetSize && this.registry.size > 0) {
            let oldest: CloneEntry | null = null;
            let oldestRepo: string | null = null;
            for (const [repo, entry] of this.registry) {
                if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
                    oldest = entry; oldestRepo = repo;
                }
            }
            if (!oldestRepo || !oldest) break;
            try {
                await fs.rm(oldest.cloneDir, { recursive: true, force: true });
                this.totalBytes = Math.max(0, this.totalBytes - oldest.sizeBytes);
                this.registry.delete(oldestRepo);
            } catch {
                break;
            }
        }
    }
}

// Module-level default for single-tenant / backward-compat use.
export const defaultCloneState = new CloneState();
