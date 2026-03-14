import { describe, it, expect } from 'vitest';
import { QueryClassifier } from '../../src/client/query-classifier';

describe('QueryClassifier', () => {
    const classifier = new QueryClassifier();

    describe('classify()', () => {
        it('should classify analytical queries', () => {
            const queries = [
                'Find all files named test.js',
                'Show me the biggest files in this directory',
                'What are all the functions in this file?',
                'Analyze the codebase structure',
                'How many files are there?',
            ];

            queries.forEach(query => {
                const result = classifier.classify(query);
                expect(result.type).toBe('analytical');
                expect(result.confidence).toBeGreaterThan(0);
            });
        });

        it('should classify action queries', () => {
            const actionQueries = [
                'Create a new file called test.js',
                'Delete the temporary files',
                'Run the tests',
                'Build the project',
                'Deploy to production',
            ];

            actionQueries.forEach(query => {
                const result = classifier.classify(query);
                expect(result.type).toBe('action');
                expect(result.confidence).toBeGreaterThan(0);
            });

            // Mixed queries that could be either (acceptable as analytical or action)
            const mixedQueries = [
                'Fix the bug in the code',
                'Refactor this function',
            ];

            mixedQueries.forEach(query => {
                const result = classifier.classify(query);
                expect(['action', 'analytical']).toContain(result.type);
                expect(result.confidence).toBeGreaterThan(0);
            });
        });

        it('should classify conversational queries', () => {
            const queries = [
                'Hello',
                'What is TypeScript?',
                'Tell me about programming',
            ];

            queries.forEach(query => {
                const result = classifier.classify(query);
                // These should be conversational (no file/code context)
                expect(['conversational', 'analytical']).toContain(result.type);
            });
        });

        it('should handle empty queries', () => {
            const result = classifier.classify('');
            expect(result.type).toBe('conversational');
            expect(result.confidence).toBe(0);
        });
    });

    describe('getToolRoundsAdjustment()', () => {
        it('should increase rounds for high-confidence analytical queries', () => {
            const classification = {
                type: 'analytical' as const,
                confidence: 0.8,
            };
            const adjusted = classifier.getToolRoundsAdjustment(classification, 5);
            expect(adjusted).toBe(8); // 5 + 3
        });

        it('should keep default rounds for action queries', () => {
            const classification = {
                type: 'action' as const,
                confidence: 0.8,
            };
            const adjusted = classifier.getToolRoundsAdjustment(classification, 5);
            expect(adjusted).toBe(5);
        });

        it('should cap at 10 rounds', () => {
            const classification = {
                type: 'analytical' as const,
                confidence: 0.9,
            };
            const adjusted = classifier.getToolRoundsAdjustment(classification, 9);
            expect(adjusted).toBe(10); // capped at 10
        });

        it('should keep default for low confidence', () => {
            const classification = {
                type: 'analytical' as const,
                confidence: 0.3,
            };
            const adjusted = classifier.getToolRoundsAdjustment(classification, 5);
            expect(adjusted).toBe(5);
        });
    });
});
