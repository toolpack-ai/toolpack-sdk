import { MetadataFilter } from '../interfaces.js';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimensions');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (denominator === 0) {
    return 0;
  }
  
  return dotProduct / denominator;
}

export function matchesFilter(metadata: Record<string, unknown>, filter?: MetadataFilter): boolean {
  if (!filter) return true;
  
  for (const [key, value] of Object.entries(filter)) {
    const metaValue = metadata[key];
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if ('$in' in value) {
        const inArray = (value as { $in: unknown[] }).$in;
        if (!inArray.includes(metaValue)) return false;
      } else if ('$gt' in value) {
        const gtValue = (value as { $gt: number }).$gt;
        if (typeof metaValue !== 'number' || metaValue <= gtValue) return false;
      } else if ('$lt' in value) {
        const ltValue = (value as { $lt: number }).$lt;
        if (typeof metaValue !== 'number' || metaValue >= ltValue) return false;
      }
    } else {
      if (metaValue !== value) return false;
    }
  }
  
  return true;
}
