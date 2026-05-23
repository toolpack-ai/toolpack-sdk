// Parse a duration string like '30d', '24h', '60m' into milliseconds.
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(d|h|m|s)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected a number followed by d/h/m/s (e.g., "30d", "24h").`
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] as 'd' | 'h' | 'm' | 's';
  const msPerUnit = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };
  return value * msPerUnit[unit];
}

// Parse a dueBy value: ISO 8601 date string stays as-is; duration strings
// are converted to an absolute ISO date from now.
export function parseDueBy(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value; // already an ISO date
  }
  // treat as duration from now
  const ms = parseDurationMs(value);
  return new Date(Date.now() + ms).toISOString().slice(0, 10);
}

// Cosine similarity between two equal-length vectors. Returns 0 for zero vectors.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Estimate token count (chars / 4, rounded up).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
