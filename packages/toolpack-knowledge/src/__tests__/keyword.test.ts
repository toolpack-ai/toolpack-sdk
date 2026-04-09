import { describe, it, expect } from 'vitest';
import { keywordSearch, combineScores } from '../../dist/index.js';

describe('keywordSearch', () => {
  it('should return 1.0 for exact matches', () => {
    const text = 'This is a test document with some content.';
    const query = 'test document';
    expect(keywordSearch(text, query)).toBe(1.0);
  });

  it('should return partial scores for word matches', () => {
    const text = 'This is a test document with some content.';
    const query = 'test content extra';
    const score = keywordSearch(text, query);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });

  it('should return 0 for no matches', () => {
    const text = 'This is a test document.';
    const query = 'nonexistent';
    expect(keywordSearch(text, query)).toBe(0);
  });

  it('should handle case insensitive matching', () => {
    const text = 'This is a TEST document.';
    const query = 'test';
    expect(keywordSearch(text, query)).toBe(1.0);
  });
});

describe('combineScores', () => {
  it('should combine semantic and keyword scores', () => {
    const semanticScore = 0.8;
    const keywordScore = 0.6;
    const combined = combineScores(semanticScore, keywordScore, 0.7);
    expect(combined).toBe(0.8 * 0.7 + 0.6 * 0.3);
  });

  it('should handle equal weights', () => {
    const semanticScore = 0.9;
    const keywordScore = 0.5;
    const combined = combineScores(semanticScore, keywordScore, 0.5);
    expect(combined).toBe(0.7);
  });
});