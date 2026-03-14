import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { sharedParserFactory } from './shared.js';

export interface IndexData {
    symbolLocations: Map<string, Set<string>>; // symbolName -> Set of filePaths
}

export class FileIndex {
    private isBuilt = false;
    private isBuilding = false;
    private data: IndexData = {
        symbolLocations: new Map()
    };

    // File modification times to check for stale cache
    private fileMtimes: Map<string, number> = new Map();

    private readonly supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'];

    private async getAllSupportedFiles(dirPath: string): Promise<string[]> {
        const files: string[] = [];
        try {
            const entries = readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
                if (entry.isDirectory()) {
                    files.push(...(await this.getAllSupportedFiles(fullPath)));
                } else if (entry.isFile() && this.supportedExtensions.includes(extname(entry.name).toLowerCase())) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Ignore unreadable dirs
        }
        return files;
    }

    async buildIndex(directory: string): Promise<void> {
        if (this.isBuilt || this.isBuilding) return;
        this.isBuilding = true;

        try {
            const files = await this.getAllSupportedFiles(directory);

            for (const file of files) {
                await this.updateFile(file);
            }

            this.isBuilt = true;
        } finally {
            this.isBuilding = false;
        }
    }

    async updateFile(filePath: string): Promise<void> {
        try {
            const stats = statSync(filePath);
            const mtime = stats.mtimeMs;

            // Skip if untouched
            if (this.fileMtimes.get(filePath) === mtime) {
                return;
            }

            const content = readFileSync(filePath, 'utf-8');
            const parser = sharedParserFactory.getParser(filePath);

            // Clean up old entries for this file
            this.removeFileFromIndex(filePath);

            // Re-parse and update
            const symbols = await parser.getSymbols({ filePath, content });

            for (const sym of symbols) {
                const existing = this.data.symbolLocations.get(sym.name);
                if (existing) {
                    existing.add(filePath);
                } else {
                    this.data.symbolLocations.set(sym.name, new Set([filePath]));
                }
            }

            this.fileMtimes.set(filePath, mtime);

        } catch (error) {
            // Ignore unreadable/unparseable files
            this.removeFileFromIndex(filePath);
        }
    }

    private removeFileFromIndex(filePath: string) {
        for (const [symbol, files] of this.data.symbolLocations.entries()) {
            files.delete(filePath);
            if (files.size === 0) {
                this.data.symbolLocations.delete(symbol);
            }
        }
        this.fileMtimes.delete(filePath);
    }

    async getDefinitionFiles(symbolName: string, workspaceDir: string): Promise<string[]> {
        await this.buildIndex(workspaceDir);
        const files = this.data.symbolLocations.get(symbolName);
        return files ? Array.from(files) : [];
    }
}
