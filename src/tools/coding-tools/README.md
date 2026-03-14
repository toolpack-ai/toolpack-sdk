# Coding Tools

This package provides a set of powerful, AST-aware coding tools for the Toolpack SDK.

## Features

- **Multi-Language Support**: Powered by `web-tree-sitter` (WASM), these tools work across 40+ programming languages including JavaScript, TypeScript, Python, Go, Rust, Java, C, and C++.
- **Zero Configuration**: Languages are parsed uniformly using a universal `ParserFactory`.
- **Hybrid Grammar Loading**: Ships with pre-bundled WASM grammars for top languages (Python, Go, Rust, Java, C/C++) and seamlessly falls back auto-downloading others as needed.

## Tools

| Tool | Type | Description |
|------|------|-------------|
| \`coding.find_symbol\` | AST | AST-aware symbol search across a file or directory |
| \`coding.get_symbols\` | AST | Lists all symbols (functions, classes, etc.) in a file |
| \`coding.get_imports\` | AST | Parses and details import statements |
| \`coding.find_references\` | AST | Finds all references to a specific symbol |
| \`coding.go_to_definition\`| AST | Jumps to the declaration/definition of a symbol |
| \`coding.get_outline\` | AST | Provides a hierarchical outline of file structure |
| \`coding.get_diagnostics\` | AST | Detects syntax errors via parsing |
| \`coding.get_exports\` | AST | Lists all exported symbols from a file |
| \`coding.multi_file_edit\` | Text | Handles atomic text-based edits across multiple files |
| \`coding.refactor_rename\` | Text | Renames symbols systematically using structural analysis |

## Architecture

At the core is the `ParsingContext` which manages:
1. **Tree Caching**: ASTs are cached with LRU eviction to avoid duplicate parses.
2. **Parser Abstraction**: `LanguageParser` interface abstracts `BabelParser` (for JS/TS) and `TreeSitterParser` (for all others).
3. **Query Executions**: Language-specific S-expression queries (e.g., `queries/python.ts`) are matched by generic tool logic.
