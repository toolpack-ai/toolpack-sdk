import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
    LanguageParser, ParserContext, SymbolLocation,
    SymbolInfo, ImportInfo, ReferenceInfo, OutlineNode,
    ExportInfo, Diagnostic, ExtractFunctionResult, CallHierarchyNode, CallHierarchyItem
} from './types.js';

export class BabelParser implements LanguageParser {

    private parseCode(content: string): ReturnType<typeof parse> {
        return parse(content, {
            sourceType: 'module',
            plugins: [
                'jsx',
                'typescript',
                'decorators-legacy',
                'classProperties',
                'objectRestSpread',
                'optionalChaining',
                'nullishCoalescingOperator',
            ],
        });
    }

    async findSymbols(context: ParserContext, symbolName: string, kindFilter?: string): Promise<SymbolLocation[]> {
        const results: SymbolLocation[] = [];
        try {
            const ast = this.parseCode(context.content);
            const filePath = context.filePath;

            traverse(ast, {
                FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
                    if (path.node.id?.name === symbolName) {
                        if (!kindFilter || kindFilter === 'function') {
                            results.push({
                                file: filePath,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                                kind: 'function',
                                name: symbolName,
                            });
                        }
                    }
                },
                ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
                    if (path.node.id?.name === symbolName) {
                        if (!kindFilter || kindFilter === 'class') {
                            results.push({
                                file: filePath,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                                kind: 'class',
                                name: symbolName,
                            });
                        }
                    }
                },
                VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
                    if (path.node.id.type === 'Identifier' && path.node.id.name === symbolName) {
                        const parent = path.parent;
                        const kind = parent.type === 'VariableDeclaration' ? parent.kind : 'variable';

                        if (!kindFilter || kindFilter === kind || kindFilter === 'variable') {
                            results.push({
                                file: filePath,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                                kind,
                                name: symbolName,
                            });
                        }
                    }
                },
                TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
                    if (path.node.id.name === symbolName) {
                        if (!kindFilter || kindFilter === 'interface') {
                            results.push({
                                file: filePath,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                                kind: 'interface',
                                name: symbolName,
                            });
                        }
                    }
                },
                TSTypeAliasDeclaration(path: NodePath<t.TSTypeAliasDeclaration>) {
                    if (path.node.id.name === symbolName) {
                        if (!kindFilter || kindFilter === 'type') {
                            results.push({
                                file: filePath,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                                kind: 'type',
                                name: symbolName,
                            });
                        }
                    }
                },
            });
        } catch (error) {
            // Ignore parse errors
        }
        return results;
    }

    async getSymbols(context: ParserContext, kindFilter?: string): Promise<SymbolInfo[]> {
        const symbols: SymbolInfo[] = [];
        try {
            const ast = this.parseCode(context.content);
            traverse(ast, {
                FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
                    if (path.node.id?.name && (!kindFilter || kindFilter === 'function')) {
                        symbols.push({
                            name: path.node.id.name,
                            kind: 'function',
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                        });
                    }
                },
                ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
                    if (path.node.id?.name && (!kindFilter || kindFilter === 'class')) {
                        symbols.push({
                            name: path.node.id.name,
                            kind: 'class',
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                        });
                    }
                },
                VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
                    if (path.node.id.type === 'Identifier') {
                        const parent = path.parent;
                        const kind = parent.type === 'VariableDeclaration' ? parent.kind : 'variable';
                        if (!kindFilter || kindFilter === kind || kindFilter === 'variable') {
                            symbols.push({
                                name: path.node.id.name,
                                kind,
                                line: path.node.loc?.start.line || 0,
                                column: path.node.loc?.start.column || 0,
                            });
                        }
                    }
                },
                TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
                    if (!kindFilter || kindFilter === 'interface') {
                        symbols.push({
                            name: path.node.id.name,
                            kind: 'interface',
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                        });
                    }
                },
                TSTypeAliasDeclaration(path: NodePath<t.TSTypeAliasDeclaration>) {
                    if (!kindFilter || kindFilter === 'type') {
                        symbols.push({
                            name: path.node.id.name,
                            kind: 'type',
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                        });
                    }
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to parse file "${context.filePath}": ${error.message}`);
        }
        return symbols;
    }

    async getImports(context: ParserContext): Promise<ImportInfo[]> {
        const imports: ImportInfo[] = [];
        try {
            const ast = this.parseCode(context.content);
            traverse(ast, {
                ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
                    const source = path.node.source.value;
                    const importedNames: string[] = [];
                    let type: 'named' | 'default' | 'namespace' | 'side-effect' = 'side-effect';

                    for (const specifier of path.node.specifiers) {
                        if (specifier.type === 'ImportDefaultSpecifier') {
                            importedNames.push(specifier.local.name);
                            type = 'default';
                        } else if (specifier.type === 'ImportNamespaceSpecifier') {
                            importedNames.push(`* as ${specifier.local.name}`);
                            type = 'namespace';
                        } else if (specifier.type === 'ImportSpecifier') {
                            const imported = specifier.imported.type === 'Identifier'
                                ? specifier.imported.name
                                : specifier.imported.value;
                            const local = specifier.local.name;
                            importedNames.push(imported === local ? imported : `${imported} as ${local}`);
                            type = 'named';
                        }
                    }

                    imports.push({
                        source,
                        imports: importedNames,
                        line: path.node.loc?.start.line || 0,
                        type,
                    });
                }
            });
        } catch (error: any) {
            throw new Error(`Failed to parse file "${context.filePath}": ${error.message}`);
        }
        return imports;
    }

    async findReferences(context: ParserContext, symbolName: string, includeDeclaration: boolean): Promise<ReferenceInfo[]> {
        const results: ReferenceInfo[] = [];
        try {
            const code = context.content;
            const lines = code.split('\n');
            const ast = this.parseCode(code);

            traverse(ast, {
                Identifier(path: NodePath<t.Identifier>) {
                    if (path.node.name === symbolName) {
                        const isDeclaration =
                            path.isFunctionDeclaration() ||
                            path.isClassDeclaration() ||
                            (path.parent.type === 'VariableDeclarator' && path.parent.id === path.node) ||
                            (path.parent.type === 'TSInterfaceDeclaration' && path.parent.id === path.node) ||
                            (path.parent.type === 'TSTypeAliasDeclaration' && path.parent.id === path.node);

                        if (!isDeclaration || includeDeclaration) {
                            const line = path.node.loc?.start.line || 0;
                            const column = path.node.loc?.start.column || 0;
                            const contextLine = lines[line - 1] || '';

                            results.push({
                                file: context.filePath,
                                line,
                                column,
                                context: contextLine.trim(),
                                isDeclaration,
                            });
                        }
                    }
                },
            });
        } catch (error) {
            // Ignore parse errors
        }
        return results;
    }

    async getSymbolAtPosition(context: ParserContext, line: number, column: number): Promise<string | null> {
        try {
            const ast = this.parseCode(context.content);
            let symbolName: string | null = null;
            traverse(ast, {
                Identifier(path: NodePath<t.Identifier>) {
                    const loc = path.node.loc;
                    if (loc && loc.start.line === line && loc.start.column === column) {
                        symbolName = path.node.name;
                        path.stop();
                    }
                },
            });
            return symbolName;
        } catch (error) {
            return null;
        }
    }

    async getDefinition(context: ParserContext, symbolName: string): Promise<SymbolLocation | null> {
        try {
            const ast = this.parseCode(context.content);
            const filePath = context.filePath;
            let definition: SymbolLocation | null = null;

            traverse(ast, {
                FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
                    if (path.node.id?.name === symbolName) {
                        definition = {
                            file: filePath,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                            kind: 'function',
                            name: symbolName,
                        };
                        path.stop();
                    }
                },
                ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
                    if (path.node.id?.name === symbolName) {
                        definition = {
                            file: filePath,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                            kind: 'class',
                            name: symbolName,
                        };
                        path.stop();
                    }
                },
                VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
                    if (path.node.id.type === 'Identifier' && path.node.id.name === symbolName) {
                        const parent = path.parent;
                        const kind = parent.type === 'VariableDeclaration' ? parent.kind : 'variable';
                        definition = {
                            file: filePath,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                            kind,
                            name: symbolName,
                        };
                        path.stop();
                    }
                },
                TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
                    if (path.node.id.name === symbolName) {
                        definition = {
                            file: filePath,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                            kind: 'interface',
                            name: symbolName,
                        };
                        path.stop();
                    }
                },
                TSTypeAliasDeclaration(path: NodePath<t.TSTypeAliasDeclaration>) {
                    if (path.node.id.name === symbolName) {
                        definition = {
                            file: filePath,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0,
                            kind: 'type',
                            name: symbolName,
                        };
                        path.stop();
                    }
                },
            });
            return definition;
        } catch (error) {
            return null;
        }
    }

    async getDiagnostics(context: ParserContext): Promise<Diagnostic[]> {
        try {
            this.parseCode(context.content);
            return []; // No syntax errors
        } catch (error: any) {
            return [{
                message: error.message,
                line: error.loc?.line || 0,
                column: error.loc?.column || 0,
                severity: 'error'
            }];
        }
    }

    async getExports(context: ParserContext): Promise<ExportInfo[]> {
        const exportsList: ExportInfo[] = [];
        try {
            const ast = this.parseCode(context.content);
            traverse(ast, {
                ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
                    if (path.node.declaration) {
                        if (path.node.declaration.type === 'VariableDeclaration') {
                            for (const decl of path.node.declaration.declarations) {
                                if (decl.id.type === 'Identifier') {
                                    exportsList.push({
                                        name: decl.id.name,
                                        kind: 'variable',
                                        line: decl.loc?.start.line || 0,
                                        column: decl.loc?.start.column || 0,
                                    });
                                }
                            }
                        } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
                            exportsList.push({
                                name: path.node.declaration.id.name,
                                kind: 'function',
                                line: path.node.declaration.loc?.start.line || 0,
                                column: path.node.declaration.loc?.start.column || 0,
                            });
                        } else if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
                            exportsList.push({
                                name: path.node.declaration.id.name,
                                kind: 'class',
                                line: path.node.declaration.loc?.start.line || 0,
                                column: path.node.declaration.loc?.start.column || 0,
                            });
                        }
                    } else if (path.node.specifiers) {
                        for (const specifier of path.node.specifiers) {
                            if (specifier.exported.type === 'Identifier') {
                                exportsList.push({
                                    name: specifier.exported.name,
                                    kind: 'export',
                                    line: specifier.loc?.start.line || 0,
                                    column: specifier.loc?.start.column || 0,
                                });
                            }
                        }
                    }
                },
                ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
                    let name = 'default';
                    let kind = 'default';
                    if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
                        name = path.node.declaration.id.name;
                        kind = 'class';
                    } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
                        name = path.node.declaration.id.name;
                        kind = 'function';
                    } else if (path.node.declaration.type === 'Identifier') {
                        name = path.node.declaration.name;
                        kind = 'variable';
                    }
                    exportsList.push({
                        name,
                        kind,
                        line: path.node.loc?.start.line || 0,
                        column: path.node.loc?.start.column || 0,
                    });
                }
            });
        } catch (error) {
            // ignore
        }
        return exportsList;
    }

    async getOutline(context: ParserContext): Promise<OutlineNode[]> {
        const rootNodes: OutlineNode[] = [];
        try {
            const symbols = await this.getSymbols(context);
            return symbols.map(s => ({
                name: s.name,
                kind: s.kind,
                line: s.line,
                column: s.column,
                children: [] // Simplified structure for now
            }));
        } catch (error) {
            // ignore
        }
        return rootNodes;
    }

    async extractFunction(context: ParserContext, startLine: number, _startColumn: number, endLine: number, _endColumn: number, newFunctionName: string): Promise<ExtractFunctionResult | null> {
        // Advanced scope variable extraction (Phase 5 fallback to text generation)
        const lines = context.content.split('\n');

        // Ensure bounds
        const start = Math.max(0, startLine - 1);
        const end = Math.min(lines.length, endLine);

        const originalCode = lines.slice(start, end).join('\n');
        const functionStr = `\nfunction ${newFunctionName}() {\n${originalCode}\n}\n`;
        const replacementStr = `${newFunctionName}();`;

        return {
            newFunction: functionStr,
            replacementCall: replacementStr
        };
    }

    async getCallHierarchy(context: ParserContext, line: number, _column: number): Promise<CallHierarchyNode | null> {
        try {
            const ast = this.parseCode(context.content);
            const filePath = context.filePath;

            let targetFunctionPath: NodePath<t.Function> | null = null;
            let targetName = '';
            let targetLine = 0;
            let targetColumn = 0;

            traverse(ast, {
                Function(path: NodePath<t.Function>) {
                    const loc = path.node.loc;
                    if (loc && loc.start.line <= line && loc.end && loc.end.line >= line) {
                        targetFunctionPath = path;
                        targetLine = loc.start.line;
                        targetColumn = loc.start.column;
                        if (path.node.type === 'FunctionDeclaration' && path.node.id) {
                            targetName = path.node.id.name;
                        } else if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
                            targetName = path.parent.id.name;
                        } else if (path.parent.type === 'ClassMethod' || path.parent.type === 'ObjectMethod') {
                            if (path.parent.key.type === 'Identifier') targetName = path.parent.key.name;
                        } else {
                            targetName = '<anonymous>';
                        }
                    }
                }
            });

            if (!targetFunctionPath || targetName === '<anonymous>') return null;

            const callers: CallHierarchyItem[] = [];
            const callees: CallHierarchyItem[] = [];

            // Extract outgoing calls from within the target function's line range
            traverse(ast, {
                CallExpression(path: NodePath<t.CallExpression>) {
                    const callLoc = path.node.loc;
                    if (!callLoc || callLoc.start.line < targetLine || (callLoc.end && callLoc.end.line > (targetLine + 1000))) return;
                    // Check if this call is inside the target function
                    let insideTarget = false;
                    let parent: NodePath | null = path;
                    while (parent) {
                        if (parent.isFunction() && parent.node.type === 'FunctionDeclaration' && parent.node.id?.name === targetName) {
                            insideTarget = true;
                            break;
                        }
                        parent = parent.parentPath;
                    }
                    if (!insideTarget) return;

                    const callee = path.node.callee;
                    let name = '<unknown>';
                    if (callee.type === 'Identifier') {
                        name = callee.name;
                    } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                        name = callee.property.name;
                    }
                    if (name !== '<unknown>') {
                        callees.push({
                            file: filePath,
                            name,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0
                        });
                    }
                }
            });

            traverse(ast, {
                CallExpression(callPath) {
                    const callee = callPath.node.callee;
                    let match = false;
                    if (callee.type === 'Identifier' && callee.name === targetName) {
                        match = true;
                    } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === targetName) {
                        match = true;
                    }

                    if (match) {
                        let callerName = '<global>';
                        let currentPath: NodePath | null = callPath;
                        while (currentPath) {
                            if (currentPath.isFunction()) {
                                if (currentPath.node.type === 'FunctionDeclaration' && currentPath.node.id) {
                                    callerName = currentPath.node.id.name;
                                } else if (currentPath.parent.type === 'VariableDeclarator' && currentPath.parent.id.type === 'Identifier') {
                                    callerName = currentPath.parent.id.name;
                                } else if (currentPath.parent.type === 'ClassMethod' || currentPath.parent.type === 'ObjectMethod') {
                                    if (currentPath.parent.key.type === 'Identifier') callerName = currentPath.parent.key.name;
                                }
                                break;
                            }
                            currentPath = currentPath.parentPath;
                        }

                        callers.push({
                            file: filePath,
                            name: callerName,
                            line: callPath.node.loc?.start.line || 0,
                            column: callPath.node.loc?.start.column || 0
                        });
                    }
                }
            });

            const uniqueCallers = [...new Map(callers.map(c => [`${c.name}:${c.line}`, c])).values()];
            const uniqueCallees = [...new Map(callees.map(c => [`${c.name}:${c.line}`, c])).values()];

            return {
                file: filePath,
                name: targetName,
                line: targetLine,
                column: targetColumn,
                callers: uniqueCallers,
                callees: uniqueCallees
            };

        } catch (error) {
            return null;
        }
    }
}
