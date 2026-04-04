import type { ToolProject } from "../types.js";
import { codingFindSymbolTool } from './tools/find-symbol/index.js';
import { codingGetSymbolsTool } from './tools/get-symbols/index.js';
import { codingGetImportsTool } from './tools/get-imports/index.js';
import { codingFindReferencesTool } from './tools/find-references/index.js';
import { codingGoToDefinitionTool } from './tools/go-to-definition/index.js';
import { codingMultiFileEditTool } from './tools/multi-file-edit/index.js';
import { codingRefactorRenameTool } from './tools/refactor-rename/index.js';
import { codingGetOutlineTool } from './tools/get-outline/index.js';
import { codingGetDiagnosticsTool } from './tools/get-diagnostics/index.js';
import { codingGetExportsTool } from './tools/get-exports/index.js';
import { codingExtractFunctionTool } from './tools/extract-function/index.js';
import { codingGetCallHierarchyTool } from './tools/get-call-hierarchy/index.js';

export { codingFindSymbolTool } from './tools/find-symbol/index.js';
export { codingGetSymbolsTool } from './tools/get-symbols/index.js';
export { codingGetImportsTool } from './tools/get-imports/index.js';
export { codingFindReferencesTool } from './tools/find-references/index.js';
export { codingGoToDefinitionTool } from './tools/go-to-definition/index.js';
export { codingMultiFileEditTool } from './tools/multi-file-edit/index.js';
export { codingRefactorRenameTool } from './tools/refactor-rename/index.js';
export { codingGetOutlineTool } from './tools/get-outline/index.js';
export { codingGetDiagnosticsTool } from './tools/get-diagnostics/index.js';
export { codingGetExportsTool } from './tools/get-exports/index.js';
export { codingExtractFunctionTool } from './tools/extract-function/index.js';
export { codingGetCallHierarchyTool } from './tools/get-call-hierarchy/index.js';

export const codingToolsProject: ToolProject = {
    manifest: {
        key: 'coding',
        name: 'coding-tools',
        displayName: 'Code Intelligence',
        version: '1.0.0',
        description: 'AST-aware code intelligence tools for finding symbols, references, and analyzing code structure.',
        author: 'Sajeer',
        tools: [
            'coding.find_symbol',
            'coding.get_symbols',
            'coding.get_imports',
            'coding.find_references',
            'coding.go_to_definition',
            'coding.get_outline',
            'coding.get_diagnostics',
            'coding.get_exports',
            'coding.extract_function',
            'coding.get_call_hierarchy',
            'coding.multi_file_edit',
            'coding.refactor_rename',
        ],
        category: 'coding',
    },
    tools: [
        codingFindSymbolTool,
        codingGetSymbolsTool,
        codingGetImportsTool,
        codingFindReferencesTool,
        codingGoToDefinitionTool,
        codingGetOutlineTool,
        codingGetDiagnosticsTool,
        codingGetExportsTool,
        codingExtractFunctionTool,
        codingGetCallHierarchyTool,
        codingMultiFileEditTool,
        codingRefactorRenameTool,
    ],
    dependencies: {
        '@babel/parser': '^7.24.0',
        '@babel/traverse': '^7.24.0',
        '@babel/types': '^7.24.0',
    },
};
