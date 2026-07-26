import { readFile, readdir } from 'fs/promises';
import { resolve, join, extname } from 'path';
import { parseRuleFile } from './parser.js';

const DEFAULT_RULES_DIR = '.toolpack/rules';

export class RuleLoader {
    private fileCache: Map<string, string> = new Map();
    private modeCache: Map<string, string> = new Map();

    async loadForMode(modeName: string, rulesDir?: string): Promise<string> {
        const dir = rulesDir ?? DEFAULT_RULES_DIR;
        const cacheKey = `${modeName}:${dir}`;
        if (this.modeCache.has(cacheKey)) {
            return this.modeCache.get(cacheKey)!;
        }

        const collected = new Set<string>();

        // 1. __global__ subfolder — applies to all modes sharing this rulesDir
        await this.collectFromFolder(join(dir, '__global__'), collected);

        // 2. Mode-named subfolder — applies to this mode only
        if (modeName) {
            await this.collectFromFolder(join(dir, modeName), collected);
        }

        if (collected.size === 0) {
            this.modeCache.set(cacheKey, '');
            return '';
        }

        const contents: string[] = [];
        for (const filePath of collected) {
            const raw = await this.readFileCached(filePath);
            if (!raw) continue;
            const parsed = parseRuleFile(raw);
            if (parsed) contents.push(parsed);
        }

        if (contents.length === 0) {
            this.modeCache.set(cacheKey, '');
            return '';
        }

        const merged = `<rules>\n${contents.join('\n\n')}\n</rules>`;
        this.modeCache.set(cacheKey, merged);
        return merged;
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

    private async readFileCached(filePath: string): Promise<string> {
        if (this.fileCache.has(filePath)) {
            return this.fileCache.get(filePath)!;
        }
        try {
            const content = await readFile(filePath, 'utf-8');
            this.fileCache.set(filePath, content);
            return content;
        } catch {
            return '';
        }
    }
}
