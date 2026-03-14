/**
 * BM25 Search Engine for Tool Discovery
 * 
 * BM25 (Best Matching 25) is the industry-standard ranking algorithm used by:
 * - Elasticsearch
 * - Anthropic's Tool Search
 * - Apache Lucene/Solr
 * 
 * Searches across: name, displayName, description, category, parameter names
 * Returns: Top N tools ranked by relevance score
 */

import { ToolDefinition, ToolSchema } from '../types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolDocument {
    toolName: string;
    tool: ToolDefinition;
    text: string;
    tokens: string[];
    length: number;
    termFrequencies: Map<string, number>;
}

export interface SearchOptions {
    limit?: number;
    category?: string;
    minScore?: number;
}

export interface SearchResult {
    toolName: string;
    score: number;
    tool: ToolSchema;
}

// Field weights for scoring (higher = more important)
const FIELD_WEIGHTS = {
    name: 3.0,
    displayName: 2.5,
    description: 2.0,
    category: 1.5,
    parameterNames: 1.0,
    parameterDescriptions: 0.5,
};

// ── BM25 Search Engine ───────────────────────────────────────────────────────

export class BM25SearchEngine {
    private documents: ToolDocument[] = [];
    private avgDocLength: number = 0;
    private idf: Map<string, number> = new Map();
    private totalDocs: number = 0;
    private docFrequencies: Map<string, number> = new Map();

    // BM25 hyperparameters (tuned for short documents like tool descriptions)
    private k1 = 1.2;  // Term frequency saturation parameter
    private b = 0.75;  // Document length normalization parameter

    /**
     * Index all tools for search.
     * Call this once after loading all tools.
     */
    index(tools: ToolDefinition[]): void {
        this.documents = [];
        this.docFrequencies.clear();
        this.idf.clear();

        // Create documents with weighted text
        for (const tool of tools) {
            const doc = this.createDocument(tool);
            this.documents.push(doc);

            // Count document frequencies for IDF
            const uniqueTerms = new Set(doc.tokens);
            for (const term of uniqueTerms) {
                this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
            }
        }

        this.totalDocs = this.documents.length;
        this.computeIDF();
        this.avgDocLength = this.computeAvgDocLength();
    }

    /**
     * Search for tools matching the query.
     * Returns top N results sorted by relevance score.
     */
    search(query: string, options?: SearchOptions): SearchResult[] {
        const limit = options?.limit ?? 5;
        const category = options?.category;
        const minScore = options?.minScore ?? 0;

        const queryTerms = this.tokenize(query.toLowerCase());
        if (queryTerms.length === 0) {
            return [];
        }

        const scores: Array<{ toolName: string; score: number; tool: ToolDefinition }> = [];

        for (const doc of this.documents) {
            // Category filter
            if (category && doc.tool.category !== category) {
                continue;
            }

            const score = this.computeBM25Score(queryTerms, doc);
            if (score > minScore) {
                scores.push({
                    toolName: doc.toolName,
                    score,
                    tool: doc.tool,
                });
            }
        }

        // Sort by score descending, return top N
        return scores
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ toolName, score, tool }) => ({
                toolName,
                score,
                tool: this.toSchema(tool),
            }));
    }

    /**
     * Get the number of indexed tools.
     */
    getIndexedCount(): number {
        return this.documents.length;
    }

    /**
     * Check if a tool is indexed.
     */
    isIndexed(toolName: string): boolean {
        return this.documents.some(d => d.toolName === toolName);
    }

    // ── Private Methods ──────────────────────────────────────────────────────

    private createDocument(tool: ToolDefinition): ToolDocument {
        // Build weighted text from all searchable fields
        const textParts: string[] = [];

        // Name (highest weight - repeat to increase term frequency)
        for (let i = 0; i < FIELD_WEIGHTS.name; i++) {
            textParts.push(tool.name);
        }

        // Display name
        for (let i = 0; i < FIELD_WEIGHTS.displayName; i++) {
            textParts.push(tool.displayName);
        }

        // Description
        for (let i = 0; i < FIELD_WEIGHTS.description; i++) {
            textParts.push(tool.description);
        }

        // Category
        for (let i = 0; i < FIELD_WEIGHTS.category; i++) {
            textParts.push(tool.category);
        }

        // Parameter names and descriptions
        if (tool.parameters?.properties) {
            for (const [paramName, paramDef] of Object.entries(tool.parameters.properties)) {
                for (let i = 0; i < FIELD_WEIGHTS.parameterNames; i++) {
                    textParts.push(paramName);
                }
                if (paramDef.description) {
                    for (let i = 0; i < FIELD_WEIGHTS.parameterDescriptions; i++) {
                        textParts.push(paramDef.description);
                    }
                }
            }
        }

        const text = textParts.join(' ').toLowerCase();
        const tokens = this.tokenize(text);
        const termFrequencies = this.computeTermFrequencies(tokens);

        return {
            toolName: tool.name,
            tool,
            text,
            tokens,
            length: tokens.length,
            termFrequencies,
        };
    }

    private tokenize(text: string): string[] {
        // Split on non-alphanumeric, filter empty, dedupe common words
        return text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(token => token.length > 1)
            .filter(token => !STOP_WORDS.has(token));
    }

    private computeTermFrequencies(tokens: string[]): Map<string, number> {
        const frequencies = new Map<string, number>();
        for (const token of tokens) {
            frequencies.set(token, (frequencies.get(token) || 0) + 1);
        }
        return frequencies;
    }

    private computeIDF(): void {
        this.idf.clear();
        for (const [term, docFreq] of this.docFrequencies) {
            // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
            // This is the BM25 IDF variant that handles edge cases better
            const idf = Math.log((this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
            this.idf.set(term, idf);
        }
    }

    private computeAvgDocLength(): number {
        if (this.documents.length === 0) return 0;
        const totalLength = this.documents.reduce((sum, doc) => sum + doc.length, 0);
        return totalLength / this.documents.length;
    }

    private computeBM25Score(queryTerms: string[], doc: ToolDocument): number {
        let score = 0;

        for (const term of queryTerms) {
            const tf = doc.termFrequencies.get(term) || 0;
            if (tf === 0) continue;

            const idf = this.idf.get(term) || 0;
            const docLength = doc.length;

            // BM25 scoring formula
            const numerator = tf * (this.k1 + 1);
            const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
            score += idf * (numerator / denominator);
        }

        return score;
    }

    private toSchema(tool: ToolDefinition): ToolSchema {
        return {
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            parameters: tool.parameters,
            category: tool.category,
        };
    }
}

// ── Stop Words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
    'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
]);
