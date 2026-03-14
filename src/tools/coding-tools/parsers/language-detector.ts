import { extname } from 'path';

export type Language =
    | 'javascript' | 'typescript' | 'tsx' | 'jsx'
    | 'python' | 'go' | 'rust' | 'java'
    | 'c' | 'cpp' | 'ruby' | 'php' | 'swift' | 'kotlin'
    | 'haskell' | 'elixir' | 'html' | 'css' | 'json'
    | 'yaml' | 'markdown' | 'bash' | 'unknown';

const EXTENSION_MAP: Record<string, Language> = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.hs': 'haskell',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sh': 'bash',
    '.bash': 'bash'
};

export function detectLanguage(filePath: string): Language {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] || 'unknown';
}
