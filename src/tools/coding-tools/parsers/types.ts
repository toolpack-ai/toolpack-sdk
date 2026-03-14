export interface SymbolLocation {
    file: string;
    line: number;
    column: number;
    kind: string;
    name: string;
}

export interface SymbolInfo {
    name: string;
    kind: string;
    line: number;
    column: number;
}

export interface ImportInfo {
    source: string;
    imports: string[];
    line: number;
    type: 'named' | 'default' | 'namespace' | 'side-effect';
}

export interface ReferenceInfo {
    file: string;
    line: number;
    column: number;
    context: string;
    isDeclaration: boolean;
}

export interface OutlineNode {
    name: string;
    kind: string;
    line: number;
    column: number;
    children: OutlineNode[];
}

export interface ExportInfo {
    name: string;
    kind: string;
    line: number;
    column: number;
}

export interface Diagnostic {
    message: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
}

export interface ExtractFunctionResult {
    newFunction: string;
    replacementCall: string;
}

export interface CallHierarchyItem {
    file: string;
    name: string;
    line: number;
    column: number;
}

export interface CallHierarchyNode {
    file: string;
    name: string;
    line: number;
    column: number;
    callers: CallHierarchyItem[];
    callees: CallHierarchyItem[];
}

export interface ParserContext {
    filePath: string;
    content: string;
}

export interface LanguageParser {
    findSymbols(context: ParserContext, symbolName: string, kindFilter?: string): Promise<SymbolLocation[]>;
    getSymbols(context: ParserContext, kindFilter?: string): Promise<SymbolInfo[]>;
    getImports(context: ParserContext): Promise<ImportInfo[]>;
    findReferences(context: ParserContext, symbolName: string, includeDeclaration: boolean): Promise<ReferenceInfo[]>;
    getSymbolAtPosition(context: ParserContext, line: number, column: number): Promise<string | null>;
    getDefinition(context: ParserContext, symbolName: string): Promise<SymbolLocation | null>;

    // New tools added in Phase 3
    getOutline?(context: ParserContext): Promise<OutlineNode[]>;
    getDiagnostics?(context: ParserContext): Promise<Diagnostic[]>;
    getExports?(context: ParserContext): Promise<ExportInfo[]>;

    // Advanced tools added in Phase 5
    extractFunction?(context: ParserContext, startLine: number, startColumn: number, endLine: number, endColumn: number, newFunctionName: string): Promise<ExtractFunctionResult | null>;
    getCallHierarchy?(context: ParserContext, line: number, column: number): Promise<CallHierarchyNode | null>;
}
