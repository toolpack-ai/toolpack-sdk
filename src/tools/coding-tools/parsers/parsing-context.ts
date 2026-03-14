import * as WebTreeSitter from 'web-tree-sitter';
const Parser = (WebTreeSitter as any).default || (WebTreeSitter as any).Parser || WebTreeSitter;
import * as fs from 'fs';
import * as crypto from 'crypto';
import { detectLanguage } from './language-detector.js';
import { GrammarManager } from './grammar-manager.js';

interface CachedTree {
    tree: any;
    language: string;
    contentHash: string;
    lastAccessed: number;
}

export class ParsingContext {
    private treeCache: Map<string, CachedTree> = new Map();
    private maxCacheSize = 50;
    private parser: any | null = null;
    private grammarManager: GrammarManager;

    constructor() {
        this.grammarManager = new GrammarManager();
    }

    private hash(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    async getTree(filePath: string, content?: string): Promise<{ tree: any, language: string, grammar: any }> {
        const fileContent = content !== undefined ? content : fs.readFileSync(filePath, 'utf-8');
        const contentHash = this.hash(fileContent);
        const cached = this.treeCache.get(filePath);

        const language = detectLanguage(filePath);
        if (language === 'unknown') {
            throw new Error(`Unsupported file type for ${filePath}`);
        }

        const grammar = await this.grammarManager.ensureGrammar(language);

        if (cached && cached.contentHash === contentHash) {
            cached.lastAccessed = Date.now();
            return { tree: cached.tree, language: cached.language, grammar };
        }

        if (!this.parser) {
            await this.grammarManager.init();
            this.parser = new Parser();
        }

        this.parser.setLanguage(grammar);

        let tree: any;
        if (cached) {
            // we could do incremental re-parse with edit() if we tracked changes, but since this is stateless
            // across processes per tool call, or at least we only get new contents, we can't reliably build edit objects
            // unless we diff it. So for now we just re-parse fully, or we could delete the old tree and parse.
            // Actually web-tree-sitter's parse takes an old tree which is fine, it will figure it out if it is an incremental parse block?
            // Actually it needs `tree.edit()` before passing oldTree. If we don't have edits, passing oldTree might not do what we want.
            // For simplicity and correctness, if content changed entirely, we just parse from scratch:
            if (cached.tree) {
                cached.tree.delete();
            }
            tree = this.parser.parse(fileContent);
        } else {
            tree = this.parser.parse(fileContent);
        }

        this.treeCache.set(filePath, {
            tree,
            language,
            contentHash,
            lastAccessed: Date.now()
        });

        this.evictIfNeeded();

        return { tree, language, grammar };
    }

    private evictIfNeeded(): void {
        if (this.treeCache.size <= this.maxCacheSize) return;

        let oldestKey = '';
        let oldestTime = Infinity;

        for (const [key, value] of this.treeCache.entries()) {
            if (value.lastAccessed < oldestTime) {
                oldestTime = value.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            const evicted = this.treeCache.get(oldestKey);
            if (evicted) {
                evicted.tree.delete(); // Free WASM memory
            }
            this.treeCache.delete(oldestKey);
        }
    }
}
