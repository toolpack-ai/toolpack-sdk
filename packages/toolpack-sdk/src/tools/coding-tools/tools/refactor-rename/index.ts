import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { parse } from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
const traverse = (babelTraverse as any).default || babelTraverse;
import * as t from '@babel/types';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface Occurrence {
    file: string;
    line: number;
    column: number;
    oldName: string;
    newName: string;
}

interface FileChange {
    file: string;
    occurrences: number;
    changes: Occurrence[];
}

const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

function renameInFile(filePath: string, oldName: string, newName: string, dryRun: boolean): FileChange {
    const changes: Occurrence[] = [];
    
    try {
        const code = readFileSync(filePath, 'utf-8');
        const lines = code.split('\n');
        const ast = parse(code, {
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

        const positions: Array<{ line: number; column: number; length: number }> = [];

        traverse(ast, {
            Identifier(path: NodePath<t.Identifier>) {
                if (path.node.name === oldName) {
                    const line = path.node.loc?.start.line || 0;
                    const column = path.node.loc?.start.column || 0;
                    
                    positions.push({
                        line,
                        column,
                        length: oldName.length,
                    });

                    changes.push({
                        file: filePath,
                        line,
                        column,
                        oldName,
                        newName,
                    });
                }
            },
        });

        // Apply renames if not dry run
        if (!dryRun && positions.length > 0) {
            // Sort positions in reverse order to maintain correct indices
            positions.sort((a, b) => {
                if (a.line !== b.line) return b.line - a.line;
                return b.column - a.column;
            });

            const newLines = [...lines];
            for (const pos of positions) {
                const lineIndex = pos.line - 1;
                if (lineIndex >= 0 && lineIndex < newLines.length) {
                    const line = newLines[lineIndex];
                    const before = line.substring(0, pos.column);
                    const after = line.substring(pos.column + pos.length);
                    newLines[lineIndex] = before + newName + after;
                }
            }

            writeFileSync(filePath, newLines.join('\n'), 'utf-8');
        }
    } catch (error) {
        // Skip files that can't be parsed
    }
    
    return {
        file: filePath,
        occurrences: changes.length,
        changes,
    };
}

function renameInDirectory(dirPath: string, oldName: string, newName: string, dryRun: boolean): FileChange[] {
    const results: FileChange[] = [];
    
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                continue;
            }
            
            if (entry.isDirectory()) {
                results.push(...renameInDirectory(fullPath, oldName, newName, dryRun));
            } else if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(extname(entry.name))) {
                const result = renameInFile(fullPath, oldName, newName, dryRun);
                if (result.occurrences > 0) {
                    results.push(result);
                }
            }
        }
    } catch (error) {
        // Skip directories we can't read
    }
    
    return results;
}

async function execute(args: Record<string, any>): Promise<string> {
    const oldName = args.symbol as string;
    const newName = args.newName as string;
    const path = args.path as string;
    const dryRun = args.dryRun === true;

    if (!oldName) {
        throw new Error('symbol is required');
    }
    
    if (!newName) {
        throw new Error('newName is required');
    }
    
    if (!path) {
        throw new Error('path is required');
    }

    if (oldName === newName) {
        throw new Error('New name must be different from old name');
    }

    const results = renameInDirectory(path, oldName, newName, dryRun);
    const totalOccurrences = results.reduce((sum, r) => sum + r.occurrences, 0);
    const filesAffected = results.length;

    return JSON.stringify({
        success: true,
        dryRun,
        oldName,
        newName,
        filesAffected,
        totalOccurrences,
        changes: results,
    }, null, 2);
}

export const codingRefactorRenameTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
