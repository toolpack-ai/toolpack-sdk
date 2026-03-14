import {
    LanguageParser, ParserContext, SymbolLocation,
    SymbolInfo, ImportInfo, ReferenceInfo, OutlineNode,
    ExportInfo, Diagnostic, ExtractFunctionResult, CallHierarchyNode, CallHierarchyItem
} from './types.js';
import { ParsingContext } from './parsing-context.js';
import { queries } from './queries/index.js';
import './queries/python.js';
import './queries/go.js';
import './queries/rust.js';
import './queries/java.js';
import './queries/cpp.js';



export class TreeSitterParser implements LanguageParser {
    constructor(private context: ParsingContext) { }

    private async executeQuery(context: ParserContext, queryName: keyof typeof queries[string]) {
        const { tree, language, grammar } = await this.context.getTree(context.filePath, context.content);
        const langQueries = queries[language];
        if (!langQueries || !langQueries[queryName]) {
            throw new Error(`Query ${queryName} not found for language ${language}`);
        }

        const queryString = langQueries[queryName]!;
        const query = grammar.query(queryString);
        return { tree, captures: query.captures(tree.rootNode) };
    }


    async findSymbols(context: ParserContext, symbolName: string, kindFilter?: string): Promise<SymbolLocation[]> {
        const symbols = await this.getSymbols(context, kindFilter);
        return symbols
            .filter(s => s.name === symbolName)
            .map(s => ({
                file: context.filePath,
                line: s.line,
                column: s.column,
                kind: s.kind,
                name: s.name,
            }));
    }

    async getSymbols(context: ParserContext, kindFilter?: string): Promise<SymbolInfo[]> {
        const { captures } = await this.executeQuery(context, 'symbols');
        const symbols: SymbolInfo[] = [];

        for (const capture of captures) {
            if (capture.name.startsWith('name.')) {
                const kind = capture.name.split('.')[1];
                if (!kindFilter || kindFilter === kind) {
                    symbols.push({
                        name: capture.node.text,
                        kind: kind,
                        line: capture.node.startPosition.row + 1,
                        column: capture.node.startPosition.column,
                    });
                }
            }
        }
        return symbols;
    }

    async getImports(context: ParserContext): Promise<ImportInfo[]> {
        const { captures } = await this.executeQuery(context, 'imports');
        const importNodes = captures.filter((c: { name: string }) => c.name === 'import').map((c: { node: unknown }) => c.node);
        const imports: ImportInfo[] = [];

        for (const node of importNodes) {
            // Very simplified extraction: specific languages will need custom traversal logic, 
            // but for now we'll extract texts based on child structures.
            imports.push({
                source: node.text,
                imports: [node.text],
                line: node.startPosition.row + 1,
                type: 'side-effect' // Default fallback
            });
        }
        return imports;
    }

    async findReferences(context: ParserContext, symbolName: string, includeDeclaration: boolean): Promise<ReferenceInfo[]> {
        const { captures } = await this.executeQuery(context, 'references');
        const lines = context.content.split('\n');
        const results: ReferenceInfo[] = [];

        for (const capture of captures) {
            if (capture.node.text === symbolName) {
                // Rough heuristical check for declaration
                const isDeclaration = capture.node.parent?.type.includes('definition') ||
                    capture.node.parent?.type.includes('declaration');

                if (!isDeclaration || includeDeclaration) {
                    const line = capture.node.startPosition.row + 1;
                    results.push({
                        file: context.filePath,
                        line,
                        column: capture.node.startPosition.column,
                        context: lines[line - 1].trim(),
                        isDeclaration: !!isDeclaration
                    });
                }
            }
        }
        return results;
    }

    async getSymbolAtPosition(context: ParserContext, line: number, column: number): Promise<string | null> {
        const { tree } = await this.context.getTree(context.filePath, context.content);
        const node = tree.rootNode.descendantForPosition({
            row: line - 1,
            column
        });

        if (node && node.type === 'identifier') {
            return node.text;
        }
        return null;
    }

    async getDefinition(context: ParserContext, symbolName: string): Promise<SymbolLocation | null> {
        const symbols = await this.findSymbols(context, symbolName);
        return symbols.length > 0 ? symbols[0] : null;
    }

    async getDiagnostics(context: ParserContext): Promise<Diagnostic[]> {
        const { tree } = await this.context.getTree(context.filePath, context.content);
        const diagnostics: Diagnostic[] = [];

        function traverse(node: any) { // using any because web-tree-sitter types vary on node
            if (node.hasError()) {
                if (node.type === 'ERROR') {
                    diagnostics.push({
                        message: `Syntax error at line ${node.startPosition.row + 1}`,
                        line: node.startPosition.row + 1,
                        column: node.startPosition.column,
                        severity: 'error'
                    });
                }
                for (const child of node.children) {
                    traverse(child);
                }
            } else if (node.isMissing && node.isMissing()) {
                diagnostics.push({
                    message: `Missing ${node.type} at line ${node.startPosition.row + 1}`,
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    severity: 'error'
                });
            }
        }

        traverse(tree.rootNode);
        return diagnostics;
    }

    async getExports(_context: ParserContext): Promise<ExportInfo[]> {
        return []; // Simple fallback for languages without explicit exports handled
    }

    async getOutline(context: ParserContext): Promise<OutlineNode[]> {
        const symbols = await this.getSymbols(context);
        return symbols.map(s => ({
            name: s.name,
            kind: s.kind,
            line: s.line,
            column: s.column,
            children: [] // Simplified structure
        }));
    }

    async extractFunction(context: ParserContext, startLine: number, _startColumn: number, endLine: number, _endColumn: number, newFunctionName: string): Promise<ExtractFunctionResult | null> {
        const lines = context.content.split('\n');
        const start = Math.max(0, startLine - 1);
        const end = Math.min(lines.length, endLine);
        const originalCode = lines.slice(start, end).join('\n');

        let functionStr = '';
        let replacementCall = '';

        // Use basic file extension inference or getLanguage() if exposed
        const ext = context.filePath.split('.').pop()?.toLowerCase();

        if (ext === 'py' || ext === 'pyi') {
            functionStr = `\ndef ${newFunctionName}():\n${originalCode.split('\n').map(l => '    ' + l).join('\n')}\n`;
            replacementCall = `${newFunctionName}()`;
        } else if (ext === 'go') {
            functionStr = `\nfunc ${newFunctionName}() {\n${originalCode}\n}\n`;
            replacementCall = `${newFunctionName}()`;
        } else if (ext === 'rs') {
            functionStr = `\nfn ${newFunctionName}() {\n${originalCode}\n}\n`;
            replacementCall = `${newFunctionName}();`;
        } else if (ext === 'sh' || ext === 'bash') {
            functionStr = `\n${newFunctionName}() {\n${originalCode}\n}\n`;
            replacementCall = `${newFunctionName}`;
        } else {
            // Default C-family / Java styling fallback
            functionStr = `\nvoid ${newFunctionName}() {\n${originalCode}\n}\n`;
            replacementCall = `${newFunctionName}();`;
        }

        return {
            newFunction: functionStr,
            replacementCall: replacementCall
        };
    }

    async getCallHierarchy(context: ParserContext, line: number, column: number): Promise<CallHierarchyNode | null> {
        // Use the existing getSymbolAtPosition to determine what the user is pointing at
        const symbolName = await this.getSymbolAtPosition(context, line, column);
        if (!symbolName) return null;

        // Use findReferences to find potential callers across AST
        const references = await this.findReferences(context, symbolName, false);

        const callers: CallHierarchyItem[] = references.map(ref => ({
            file: ref.file,
            name: ref.context.trim() || '<anonymous>',
            line: ref.line,
            column: ref.column
        }));

        return {
            file: context.filePath,
            name: symbolName,
            line,
            column,
            callers,
            callees: [] // Extracting callees would require extensive per-language CallExpression queries
        };
    }
}
