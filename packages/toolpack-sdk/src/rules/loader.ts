import { readFile, readdir } from 'fs/promises';
import { resolve, join, extname } from 'path';
import { parseRuleFile } from './parser.js';

const DEFAULT_RULES_DIR = '.toolpack/rules';
const DEFAULT_CACHE_TTL_MS = 30_000; // 30 seconds

interface CachedModeEntry {
    value: string;
    cachedAt: number;
}

export class RuleLoader {
    // modeCache entries expire after cacheTtlMs so rule edits are picked up
    // without a process restart. fileCache is intentionally NOT persisted across
    // loadForMode() calls — it only deduplicates files within one call.
    private modeCache: Map<string, CachedModeEntry> = new Map();

    constructor(private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS) {}

    async loadForMode(modeName: string, rulesDir?: string): Promise<string> {
        const dir = rulesDir ?? DEFAULT_RULES_DIR;
        const cacheKey = `${modeName}:${dir}`;
        const cached = this.modeCache.get(cacheKey);
        if (cached && (Date.now() - cached.cachedAt) < this.cacheTtlMs) {
            return cached.value;
        }

        const collected = new Set<string>();

        // 1. __global__ subfolder — applies to all modes sharing this rulesDir
        await this.collectFromFolder(join(dir, '__global__'), collected);

        // 2. Mode-named subfolder — applies to this mode only
        if (modeName) {
            await this.collectFromFolder(join(dir, modeName), collected);
        }

        if (collected.size === 0) {
            this.modeCache.set(cacheKey, { value: '', cachedAt: Date.now() });
            return '';
        }

        // Per-call file read cache: deduplicates files that appear in multiple
        // subfolders within this one loadForMode() call, but does NOT persist
        // across calls so stale file content is never served after an edit.
        const fileReadCache = new Map<string, string>();
        const contents: string[] = [];
        for (const filePath of collected) {
            const raw = await this.readFile(filePath, fileReadCache);
            if (!raw) continue;
            const parsed = parseRuleFile(raw);
            if (parsed) contents.push(parsed);
        }

        const value = contents.length === 0
            ? ''
            : `<rules>\n${contents.join('\n\n')}\n</rules>`;

        this.modeCache.set(cacheKey, { value, cachedAt: Date.now() });
        return value;
    }

    /** Evict all cached entries — useful in tests or after a known rule file change. */
    clearCache(): void {
        this.modeCache.clear();
    }

    private async collectFromFolder(folderPath: string, collected: Set<string>): Promise<void> {
        const abs = resolve(folderPath);
        try {
            await this.collectRecursive(abs, collected);
        } catch {
            // Folder doesn't exist — silently skip
        }
    }

    private async collectRecursive(dir: string, collected: Set<string>): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.collectRecursive(full, collected);
            } else if (entry.isFile() && extname(entry.name) === '.md') {
                collected.add(full);
            }
        }
    }

    private async readFile(filePath: string, cache: Map<string, string>): Promise<string> {
        if (cache.has(filePath)) return cache.get(filePath)!;
        try {
            const content = await readFile(filePath, 'utf-8');
            cache.set(filePath, content);
            return content;
        } catch {
            return '';
        }
    }
}
