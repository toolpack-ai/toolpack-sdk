import * as WebTreeSitter from 'web-tree-sitter';
const Parser = (WebTreeSitter as any).default || (WebTreeSitter as any).Parser || WebTreeSitter;
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GRAMMAR_CACHE_DIR = path.join(os.homedir(), '.toolpack-sdk', 'grammars');
const BUNDLED_GRAMMARS_DIR = path.resolve(__dirname, '../../grammars'); // Will need to ensure this path resolves correctly when built

export class GrammarManager {
    private grammars: Map<string, any> = new Map();
    private isInitialized = false;

    async init() {
        if (!this.isInitialized) {
            await Parser.init({
                locateFile(scriptName: string, _scriptDirectory: string) {
                    return path.join(__dirname, '../../../../node_modules/web-tree-sitter', scriptName);
                }
            });
            this.isInitialized = true;
        }
    }

    async ensureGrammar(language: string): Promise<any> {
        await this.init();
        const cached = this.grammars.get(language);
        if (cached) return cached;

        const wasmPath = await this.resolveGrammarPath(language);
        const langModule = (WebTreeSitter as any).Language || Parser.Language;
        const lang = await langModule.load(wasmPath);
        this.grammars.set(language, lang);
        return lang;
    }

    private async resolveGrammarPath(language: string): Promise<string> {
        const filename = `tree-sitter-${language}.wasm`;

        // 1. Check node_modules (tree-sitter-wasms package)
        const npmPath = path.resolve(__dirname, '../../../../node_modules/tree-sitter-wasms/out', filename);
        if (fs.existsSync(npmPath)) {
            return npmPath;
        }

        // 2. Check pre-bundled grammars
        const bundledPath = path.join(BUNDLED_GRAMMARS_DIR, filename);
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }

        // 3. Check local cache (~/.toolpack-sdk/grammars/)
        const cachedPath = path.join(GRAMMAR_CACHE_DIR, filename);
        if (fs.existsSync(cachedPath)) {
            return cachedPath;
        }

        // 4. Auto-download from unpkg
        await this.downloadGrammar(language, cachedPath);
        return cachedPath;

        // The original instruction had a throw here, but the download logic followed.
        // Assuming the intent is to download if not found in bundled/cached,
        // and only throw if download also fails (which is handled by downloadGrammar itself).
        // If download fails, it will throw, so this line is effectively unreachable if download succeeds.
        // If download fails, the error will be propagated.
        // If the intent was to throw if download is not desired, then the download logic should be conditional.
        // For now, I'm making the download always happen if not found locally.
        // throw new Error(`Grammar for ${language} not found. Please install it first.`);
    }

    private async downloadGrammar(language: string, dest: string): Promise<void> {
        if (!fs.existsSync(GRAMMAR_CACHE_DIR)) {
            fs.mkdirSync(GRAMMAR_CACHE_DIR, { recursive: true });
        }

        const url = `https://unpkg.com/tree-sitter-wasms@latest/out/tree-sitter-${language}.wasm`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to download grammar for ${language}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(dest, buffer);
    }
}
