import { describe, it, expect } from 'vitest';
import { estimateTokens, splitByParagraphs, splitBySentences, applyOverlap, splitLargeChunk } from '../utils/chunking.js';

describe('estimateTokens', () => {
  it('should estimate ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('should round up', () => {
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('splitByParagraphs', () => {
  it('should split at double newlines', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = splitByParagraphs(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('Paragraph one');
  });

  it('should keep short text as one chunk', () => {
    const text = 'Short text.';
    const chunks = splitByParagraphs(text, 1000);
    expect(chunks.length).toBe(1);
  });

  it('should handle empty text', () => {
    const chunks = splitByParagraphs('', 100);
    expect(chunks.length).toBe(0);
  });
});

describe('splitBySentences', () => {
  it('should split at sentence boundaries', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const chunks = splitBySentences(text, 6);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should keep short text as one chunk', () => {
    const text = 'Just one sentence.';
    const chunks = splitBySentences(text, 1000);
    expect(chunks.length).toBe(1);
  });
});

describe('applyOverlap', () => {
  it('should not modify single-chunk arrays', () => {
    const chunks = ['Only chunk'];
    expect(applyOverlap(chunks, 10)).toEqual(['Only chunk']);
  });

  it('should not modify when overlap is 0', () => {
    const chunks = ['Chunk A', 'Chunk B'];
    expect(applyOverlap(chunks, 0)).toEqual(['Chunk A', 'Chunk B']);
  });

  it('should prepend trailing words from previous chunk', () => {
    const chunks = ['This is chunk one with many words', 'This is chunk two'];
    const result = applyOverlap(chunks, 8);
    expect(result[0]).toBe('This is chunk one with many words');
    expect(result[1]).toContain('many words');
    expect(result[1]).toContain('This is chunk two');
  });
});

describe('splitLargeChunk', () => {
  it('should return text as-is if within limit', () => {
    const text = 'Short text.';
    expect(splitLargeChunk(text, 1000)).toEqual(['Short text.']);
  });

  it('should split large text first by paragraphs then by sentences', () => {
    const paragraphs = Array(20).fill('This is a paragraph with enough words to fill space.').join('\n\n');
    const chunks = splitLargeChunk(paragraphs, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(25);
    }
  });
});
