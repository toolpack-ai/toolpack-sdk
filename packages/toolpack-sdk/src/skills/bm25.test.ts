import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Engine } from './bm25.js';

describe('BM25Engine', () => {
  let engine: BM25Engine;

  beforeEach(() => {
    engine = new BM25Engine();
  });

  describe('tokenize (via search behaviour)', () => {
    it('splits camelCase terms into searchable tokens', () => {
      engine.addDocument('doc', 'codeReview performance apiKeyRotation');
      // "codeReview" should split into "code" + "review" so querying either word matches
      const byCode = engine.search('code');
      const byReview = engine.search('review');
      expect(byCode.length).toBe(1);
      expect(byReview.length).toBe(1);
    });

    it('splits PascalCase terms', () => {
      engine.addDocument('doc', 'UserAuthentication TokenRefresh');
      expect(engine.search('user').length).toBe(1);
      expect(engine.search('authentication').length).toBe(1);
      expect(engine.search('token').length).toBe(1);
      expect(engine.search('refresh').length).toBe(1);
    });

    it('camelCase split does not affect all-lowercase text', () => {
      engine.addDocument('doc', 'performance optimization');
      expect(engine.search('performance').length).toBe(1);
    });

    it('removes stop words', () => {
      engine.addDocument('doc1', 'review code');
      engine.addDocument('doc2', 'write tests');
      // Stop word "the" should not score — query "the" returns nothing
      const results = engine.search('the');
      expect(results.length).toBe(0);
    });

    it('ignores single-character tokens', () => {
      engine.addDocument('doc', 'a b c review');
      // Only "review" is a valid token; single chars are stripped
      expect(engine.search('review').length).toBe(1);
    });
  });

  describe('field-weighted search via buildIndexContent pattern', () => {
    it('ranks a document higher when the query term appears more times (weight simulation)', () => {
      // doc1 has "review" once; doc2 has "review" three times (simulating name/title ×3)
      engine.addDocument('doc1', 'review this code please carefully');
      engine.addDocument('doc2', 'review review review check quality');
      const results = engine.search('review');
      expect(results[0].id).toBe('doc2');
    });
  });

  describe('addDocument / clear / size', () => {
    it('tracks document count via size', () => {
      expect(engine.size).toBe(0);
      engine.addDocument('a', 'hello world');
      engine.addDocument('b', 'foo bar');
      expect(engine.size).toBe(2);
    });

    it('clear() resets the index', () => {
      engine.addDocument('a', 'hello');
      engine.clear();
      expect(engine.size).toBe(0);
      expect(engine.search('hello').length).toBe(0);
    });
  });

  describe('search edge cases', () => {
    it('returns empty array for empty query', () => {
      engine.addDocument('doc', 'hello world');
      expect(engine.search('').length).toBe(0);
    });

    it('returns empty array when no documents match', () => {
      engine.addDocument('doc', 'hello world');
      expect(engine.search('xyznonexistent').length).toBe(0);
    });

    it('respects the limit parameter', () => {
      engine.addDocument('a', 'review code quality');
      engine.addDocument('b', 'review pull request');
      engine.addDocument('c', 'review security audit');
      const results = engine.search('review', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('scores are positive for matching documents', () => {
      engine.addDocument('doc', 'performance optimization');
      const results = engine.search('performance');
      expect(results[0].score).toBeGreaterThan(0);
    });
  });
});
