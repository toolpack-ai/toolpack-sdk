import { describe, it, expect, beforeEach } from 'vitest';
import { ContextWindowStateManager, createContextWindowStateManager } from '../../src/utils/context-window-state';
import { ContextWindowConfig } from '../../src/types/index';

describe('ContextWindowStateManager', () => {
    let manager: ContextWindowStateManager;
    const config: ContextWindowConfig = {
        enabled: true,
        strategy: 'prune',
        pruneThreshold: 85,
        maxMessageHistoryLength: 50,
        outputTokenBuffer: 1.15
    };

    beforeEach(() => {
        manager = new ContextWindowStateManager(config);
    });

    describe('State Creation and Retrieval', () => {
        it('should create state for a new conversation', () => {
            const state = manager.getOrCreateState('conv-1');

            expect(state.conversationId).toBe('conv-1');
            expect(state.estimatedTokens).toBe(0);
            expect(state.pruneCount).toBe(0);
            expect(state.summarizationCount).toBe(0);
            expect(state.warningsSent).toBe(0);
        });

        it('should reuse existing state for same conversation', () => {
            const state1 = manager.getOrCreateState('conv-1');
            manager.updateTokenCount('conv-1', 100);

            const state2 = manager.getOrCreateState('conv-1');

            expect(state2.estimatedTokens).toBe(100);
        });

        it('should return undefined for non-existent state', () => {
            const state = manager.getState('non-existent');

            expect(state).toBeUndefined();
        });

        it('should return existing state when it exists', () => {
            manager.getOrCreateState('conv-1');
            const state = manager.getState('conv-1');

            expect(state).toBeDefined();
            expect(state?.conversationId).toBe('conv-1');
        });
    });

    describe('Token Count Management', () => {
        it('should update token count', () => {
            manager.updateTokenCount('conv-1', 500);
            const state = manager.getState('conv-1');

            expect(state?.estimatedTokens).toBe(500);
        });

        it('should update lastUpdated timestamp', () => {
            const before = Date.now();
            manager.updateTokenCount('conv-1', 100);
            const after = Date.now();

            const state = manager.getState('conv-1');
            expect(state?.lastUpdated).toBeGreaterThanOrEqual(before);
            expect(state?.lastUpdated).toBeLessThanOrEqual(after);
        });
    });

    describe('Prune Operations', () => {
        it('should increment prune count', () => {
            manager.recordPruneOperation('conv-1', 100);
            const state = manager.getState('conv-1');

            expect(state?.pruneCount).toBe(1);
        });

        it('should record last pruned timestamp', () => {
            manager.recordPruneOperation('conv-1', 100);
            const state = manager.getState('conv-1');

            expect(state?.lastPrunedAt).toBeDefined();
            expect(typeof state?.lastPrunedAt).toBe('number');
        });

        it('should reduce estimated tokens', () => {
            manager.updateTokenCount('conv-1', 500);
            manager.recordPruneOperation('conv-1', 100);
            const state = manager.getState('conv-1');

            expect(state?.estimatedTokens).toBe(400);
        });

        it('should not allow negative tokens', () => {
            manager.updateTokenCount('conv-1', 50);
            manager.recordPruneOperation('conv-1', 100); // Try to recover more than available
            const state = manager.getState('conv-1');

            expect(state?.estimatedTokens).toBe(0);
        });

        it('should track multiple prune operations', () => {
            manager.recordPruneOperation('conv-1', 50);
            manager.recordPruneOperation('conv-1', 50);
            manager.recordPruneOperation('conv-1', 50);
            const state = manager.getState('conv-1');

            expect(state?.pruneCount).toBe(3);
        });
    });

    describe('Warning Management', () => {
        it('should record warnings', () => {
            manager.recordWarning('conv-1');
            const state = manager.getState('conv-1');

            expect(state?.warningsSent).toBe(1);
        });

        it('should increment warning count on multiple calls', () => {
            manager.recordWarning('conv-1');
            manager.recordWarning('conv-1');
            manager.recordWarning('conv-1');
            const state = manager.getState('conv-1');

            expect(state?.warningsSent).toBe(3);
        });
    });

    describe('Summarization Operations', () => {
        it('should increment summarization count', () => {
            manager.recordSummarization('conv-1', 100);
            const state = manager.getState('conv-1');

            expect(state?.summarizationCount).toBe(1);
        });

        it('should reduce tokens by saved amount', () => {
            manager.updateTokenCount('conv-1', 500);
            manager.recordSummarization('conv-1', 150);
            const state = manager.getState('conv-1');

            expect(state?.estimatedTokens).toBe(350);
        });

        it('should track multiple summarizations', () => {
            manager.recordSummarization('conv-1', 50);
            manager.recordSummarization('conv-1', 50);
            const state = manager.getState('conv-1');

            expect(state?.summarizationCount).toBe(2);
        });
    });

    describe('State Querying', () => {
        it('should get all states', () => {
            manager.getOrCreateState('conv-1');
            manager.getOrCreateState('conv-2');
            manager.getOrCreateState('conv-3');

            const allStates = manager.getAllStates();

            expect(allStates).toHaveLength(3);
        });

        it('should get statistics for a conversation', () => {
            manager.getOrCreateState('conv-1');
            manager.updateTokenCount('conv-1', 500);
            manager.recordPruneOperation('conv-1', 100);

            const stats = manager.getStatistics('conv-1');

            expect(stats).toBeDefined();
            expect(stats?.currentTokens).toBe(400);
            expect(stats?.pruneCount).toBe(1);
            expect(stats?.contextWindowPercentage).toBeGreaterThan(0);
        });

        it('should return null statistics for non-existent conversation', () => {
            const stats = manager.getStatistics('non-existent');

            expect(stats).toBeNull();
        });

        it('should identify conversations at risk', () => {
            manager.updateTokenCount('conv-1', 85000); // 85% of 100k
            manager.updateTokenCount('conv-2', 50000); // 50% of 100k

            const atRisk = manager.getAtRiskConversations(80);

            expect(atRisk.some(s => s.conversationId === 'conv-1')).toBe(true);
            expect(atRisk.some(s => s.conversationId === 'conv-2')).toBe(false);
        });

        it('should identify conversations exceeding threshold', () => {
            manager.updateTokenCount('conv-1', 150000); // Exceeds default 100k

            const exceeded = manager.getExceedingThreshold();

            expect(exceeded.some(s => s.conversationId === 'conv-1')).toBe(true);
        });
    });

    describe('State Management', () => {
        it('should delete state for a conversation', () => {
            manager.getOrCreateState('conv-1');
            const deleted = manager.deleteState('conv-1');

            expect(deleted).toBe(true);
            expect(manager.getState('conv-1')).toBeUndefined();
        });

        it('should return false when deleting non-existent state', () => {
            const deleted = manager.deleteState('non-existent');

            expect(deleted).toBe(false);
        });

        it('should clear all states', () => {
            manager.getOrCreateState('conv-1');
            manager.getOrCreateState('conv-2');

            manager.clearAllStates();

            expect(manager.getAllStates()).toHaveLength(0);
        });

        it('should prune inactive conversations', () => {
            manager.getOrCreateState('conv-1');
            manager.getOrCreateState('conv-2');

            // Manually set old timestamps
            const state1 = manager.getState('conv-1');
            const state2 = manager.getState('conv-2');
            if (state1) state1.lastUpdated = Date.now() - (65 * 60 * 1000); // 65 minutes ago
            if (state2) state2.lastUpdated = Date.now();

            const pruned = manager.pruneInactiveConversations(60);

            expect(pruned).toContain('conv-1');
            expect(pruned).not.toContain('conv-2');
            expect(manager.getState('conv-1')).toBeUndefined();
            expect(manager.getState('conv-2')).toBeDefined();
        });
    });

    describe('Reporting and Export', () => {
        it('should generate a report', () => {
            manager.getOrCreateState('conv-1');
            manager.updateTokenCount('conv-1', 500);

            const report = manager.generateReport();

            expect(report).toContain('Context Window State Report');
            expect(report).toContain('conv-1');
            expect(report).toContain('500');
        });

        it('should handle empty state report', () => {
            const report = manager.generateReport();

            expect(report).toContain('No conversations tracked yet');
        });

        it('should export state as JSON', () => {
            manager.getOrCreateState('conv-1');
            manager.updateTokenCount('conv-1', 500);

            const exported = manager.export();

            expect(exported['conv-1']).toBeDefined();
            expect(exported['conv-1'].conversationId).toBe('conv-1');
            expect(exported['conv-1'].estimatedTokens).toBe(500);
        });

        it('should import state from JSON', () => {
            const importData = {
                'conv-imported': {
                    conversationId: 'conv-imported',
                    estimatedTokens: 1000,
                    lastUpdated: Date.now(),
                    pruneCount: 5,
                    summarizationCount: 2,
                    warningsSent: 1
                }
            };

            manager.import(importData);

            const state = manager.getState('conv-imported');
            expect(state?.estimatedTokens).toBe(1000);
            expect(state?.pruneCount).toBe(5);
        });
    });

    describe('Memory Usage', () => {
        it('should report memory usage', () => {
            manager.getOrCreateState('conv-1');
            manager.getOrCreateState('conv-2');

            const usage = manager.getMemoryUsage();

            expect(usage.conversationCount).toBe(2);
            expect(usage.approximateByteSize).toBeGreaterThan(0);
        });
    });

    describe('Integrity Validation', () => {
        it('should validate integrity of states', () => {
            manager.getOrCreateState('conv-1');

            const validation = manager.validateIntegrity();

            expect(validation.isValid).toBe(true);
            expect(validation.issues).toHaveLength(0);
        });

        it('should detect invalid token counts', () => {
            const state = manager.getOrCreateState('conv-1');
            state.estimatedTokens = -1;

            const validation = manager.validateIntegrity();

            expect(validation.isValid).toBe(false);
            expect(validation.issues.some(i => i.includes('Negative token count'))).toBe(true);
        });

        it('should detect invalid counts', () => {
            const state = manager.getOrCreateState('conv-1');
            state.pruneCount = -5;

            const validation = manager.validateIntegrity();

            expect(validation.isValid).toBe(false);
            expect(validation.issues.some(i => i.includes('prune count'))).toBe(true);
        });
    });

    describe('Factory Function', () => {
        it('should create manager via factory function', () => {
            const mgr = createContextWindowStateManager(config);

            expect(mgr).toBeInstanceOf(ContextWindowStateManager);
            expect(mgr.getOrCreateState('test')).toBeDefined();
        });
    });
});
