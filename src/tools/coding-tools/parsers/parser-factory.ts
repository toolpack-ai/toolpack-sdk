import { LanguageParser } from './types.js';
import { detectLanguage } from './language-detector.js';
import { BabelParser } from './babel-parser.js';
import { TreeSitterParser } from './tree-sitter-parser.js';
import { ParsingContext } from './parsing-context.js';

export class ParserFactory {
    private babelParser: BabelParser;
    private treeSitterParser: TreeSitterParser;

    constructor(private context: ParsingContext) {
        this.babelParser = new BabelParser();
        this.treeSitterParser = new TreeSitterParser(this.context);
    }

    getParser(filePath: string): LanguageParser {
        const language = detectLanguage(filePath);

        switch (language) {
            case 'javascript':
            case 'typescript':
            case 'tsx':
            case 'jsx':
                return this.babelParser;
            case 'python':
            case 'go':
            case 'rust':
            case 'java':
            case 'c':
            case 'cpp':
                return this.treeSitterParser;
            default:
                throw new Error(`Unsupported or unknown language for file: ${filePath}`);
        }
    }
}
