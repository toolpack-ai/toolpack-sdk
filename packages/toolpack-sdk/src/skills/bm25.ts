/**
 * BM25 (Best Matching 25) search engine.
 *
 * A lightweight, zero-dependency implementation of the BM25 ranking algorithm.
 * Parameters: k1=1.5, b=0.75 (standard BM25 defaults).
 */

export interface BM25SearchResult {
  id: string;
  score: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'also', 'now', 'here', 'there', 'then',
]);

export class BM25Engine {
  private documents: Map<string, string> = new Map();
  private termFrequencies: Map<string, Map<string, number>> = new Map();
  private documentLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  private tokenize(text: string): string[] {
    if (!text) return [];

    // Split camelCase and PascalCase before lowercasing — doing this after
    // toLowerCase() would leave no uppercase letters for the regex to match.
    let normalized = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    normalized = normalized.toLowerCase();
    // Replace non-alphanumeric with spaces
    normalized = normalized.replace(/[^a-z0-9]/g, ' ');

    return normalized
      .split(/\s+/)
      .filter(token => token.length > 1)
      .filter(token => !STOP_WORDS.has(token));
  }

  addDocument(id: string, content: string): void {
    this.documents.set(id, content);

    const tokens = this.tokenize(content);
    this.documentLengths.set(id, tokens.length);

    const termCounts: Record<string, number> = {};
    for (const token of tokens) {
      termCounts[token] = (termCounts[token] ?? 0) + 1;
    }

    for (const [term, count] of Object.entries(termCounts)) {
      if (!this.termFrequencies.has(term)) {
        this.termFrequencies.set(term, new Map());
      }
      this.termFrequencies.get(term)!.set(id, count);
    }

    this.updateAvgDocLength();
  }

  clear(): void {
    this.documents.clear();
    this.termFrequencies.clear();
    this.documentLengths.clear();
    this.avgDocLength = 0;
  }

  get size(): number {
    return this.documents.size;
  }

  private updateAvgDocLength(): void {
    if (this.documentLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    this.documentLengths.forEach(len => { total += len; });
    this.avgDocLength = total / this.documentLengths.size;
  }

  private idf(term: string): number {
    const N = this.documents.size;
    const docFreq = this.termFrequencies.get(term)?.size ?? 0;
    if (docFreq === 0) return 0;
    return Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
  }

  search(query: string, limit = 10): BM25SearchResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: Record<string, number> = {};

    this.documents.forEach((_, docId) => {
      let score = 0;
      const docLength = this.documentLengths.get(docId) ?? 0;

      for (const term of queryTokens) {
        const termDocFreqs = this.termFrequencies.get(term);
        if (!termDocFreqs) continue;

        const tf = termDocFreqs.get(docId) ?? 0;
        if (tf === 0) continue;

        const idf = this.idf(term);
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores[docId] = score;
      }
    });

    const results: BM25SearchResult[] = Object.entries(scores).map(([id, score]) => ({ id, score }));
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
