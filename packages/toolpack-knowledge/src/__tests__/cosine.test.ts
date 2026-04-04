import { describe, it, expect } from 'vitest';
import { cosineSimilarity, matchesFilter } from '../utils/cosine.js';

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  it('should return 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('should throw for vectors of different lengths', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('Vectors must have same dimensions');
  });

  it('should compute similarity for non-unit vectors', () => {
    const score = cosineSimilarity([3, 4], [4, 3]);
    expect(score).toBeCloseTo(0.96, 2);
  });
});

describe('matchesFilter', () => {
  const metadata = {
    category: 'ml',
    hasCode: true,
    score: 85,
    tags: ['a', 'b'],
  };

  it('should return true when no filter provided', () => {
    expect(matchesFilter(metadata)).toBe(true);
    expect(matchesFilter(metadata, undefined)).toBe(true);
  });

  it('should match exact values', () => {
    expect(matchesFilter(metadata, { category: 'ml' })).toBe(true);
    expect(matchesFilter(metadata, { category: 'web' })).toBe(false);
  });

  it('should match boolean values', () => {
    expect(matchesFilter(metadata, { hasCode: true })).toBe(true);
    expect(matchesFilter(metadata, { hasCode: false })).toBe(false);
  });

  it('should support $in operator', () => {
    expect(matchesFilter(metadata, { category: { $in: ['ml', 'web'] } })).toBe(true);
    expect(matchesFilter(metadata, { category: { $in: ['web', 'api'] } })).toBe(false);
  });

  it('should support $gt operator', () => {
    expect(matchesFilter(metadata, { score: { $gt: 80 } })).toBe(true);
    expect(matchesFilter(metadata, { score: { $gt: 90 } })).toBe(false);
  });

  it('should support $lt operator', () => {
    expect(matchesFilter(metadata, { score: { $lt: 90 } })).toBe(true);
    expect(matchesFilter(metadata, { score: { $lt: 80 } })).toBe(false);
  });

  it('should require all filter conditions (AND logic)', () => {
    expect(matchesFilter(metadata, { category: 'ml', hasCode: true })).toBe(true);
    expect(matchesFilter(metadata, { category: 'ml', hasCode: false })).toBe(false);
  });

  it('should return false when metadata key does not exist', () => {
    expect(matchesFilter(metadata, { nonexistent: 'value' })).toBe(false);
  });

  it('should return false for $gt on non-number metadata', () => {
    expect(matchesFilter(metadata, { category: { $gt: 5 } })).toBe(false);
  });

  it('should return false for $lt on non-number metadata', () => {
    expect(matchesFilter(metadata, { category: { $lt: 5 } })).toBe(false);
  });
});
