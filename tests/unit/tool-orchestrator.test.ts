import { describe, it, expect } from 'vitest';
import { ToolOrchestrator } from '../../src/client/tool-orchestrator';
import { ToolCallResult } from '../../src/types';

describe('ToolOrchestrator', () => {
    const orchestrator = new ToolOrchestrator();

    describe('analyzeDependencies()', () => {
        it('should detect no dependencies for independent tools', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.stat', arguments: { path: '/file1.txt' } },
                { id: '2', name: 'fs.stat', arguments: { path: '/file2.txt' } },
                { id: '3', name: 'fs.stat', arguments: { path: '/file3.txt' } },
            ];

            const deps = orchestrator.analyzeDependencies(toolCalls);
            
            expect(deps).toHaveLength(3);
            expect(deps[0].dependsOn).toHaveLength(0);
            expect(deps[1].dependsOn).toHaveLength(0);
            expect(deps[2].dependsOn).toHaveLength(0);
        });

        it('should detect file path dependencies', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.read_file', arguments: { path: '/test.txt' } },
                { id: '2', name: 'fs.write_file', arguments: { path: '/test.txt', content: 'new' } },
            ];

            const deps = orchestrator.analyzeDependencies(toolCalls);
            
            expect(deps[0].dependsOn).toHaveLength(0);
            expect(deps[1].dependsOn).toHaveLength(1);
            expect(deps[1].dependsOn[0]).toBe('1');
        });

        it('should detect coding tool dependencies', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'coding.get_symbols', arguments: { file_path: '/src/index.ts' } },
                { id: '2', name: 'coding.find_references', arguments: { file_path: '/src/index.ts', symbol: 'foo' } },
            ];

            const deps = orchestrator.analyzeDependencies(toolCalls);
            
            expect(deps[1].dependsOn).toHaveLength(1);
            expect(deps[1].dependsOn[0]).toBe('1');
        });

        it('should detect exec dependencies', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'exec.run_background', arguments: { command: 'npm test' } },
                { id: '2', name: 'exec.read_output', arguments: { pid: 123 } },
            ];

            const deps = orchestrator.analyzeDependencies(toolCalls);
            
            expect(deps[1].dependsOn).toHaveLength(1);
            expect(deps[1].dependsOn[0]).toBe('1');
        });
    });

    describe('shouldUseParallelExecution()', () => {
        it('should return false for single tool', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.read_file', arguments: { path: '/test.txt' } },
            ];

            expect(orchestrator.shouldUseParallelExecution(toolCalls)).toBe(false);
        });

        it('should return true for multiple independent tools', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.stat', arguments: { path: '/file1.txt' } },
                { id: '2', name: 'fs.stat', arguments: { path: '/file2.txt' } },
            ];

            expect(orchestrator.shouldUseParallelExecution(toolCalls)).toBe(true);
        });

        it('should return false for dependent tools', () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.read_file', arguments: { path: '/test.txt' } },
                { id: '2', name: 'fs.write_file', arguments: { path: '/test.txt', content: 'new' } },
            ];

            expect(orchestrator.shouldUseParallelExecution(toolCalls)).toBe(false);
        });
    });

    describe('executeWithDependencies()', () => {
        it('should execute independent tools in parallel', async () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'tool1', arguments: {} },
                { id: '2', name: 'tool2', arguments: {} },
                { id: '3', name: 'tool3', arguments: {} },
            ];

            const executionOrder: string[] = [];
            const executor = async (toolCall: ToolCallResult) => {
                executionOrder.push(toolCall.id);
                await new Promise(resolve => setTimeout(resolve, 10));
                return `result-${toolCall.id}`;
            };

            const results = await orchestrator.executeWithDependencies(toolCalls, executor);

            expect(results.size).toBe(3);
            expect(results.get('1')).toBe('result-1');
            expect(results.get('2')).toBe('result-2');
            expect(results.get('3')).toBe('result-3');
        });

        it('should execute dependent tools sequentially', async () => {
            const toolCalls: ToolCallResult[] = [
                { id: '1', name: 'fs.read_file', arguments: { path: '/test.txt' } },
                { id: '2', name: 'fs.write_file', arguments: { path: '/test.txt', content: 'new' } },
            ];

            const executionOrder: string[] = [];
            const executor = async (toolCall: ToolCallResult) => {
                executionOrder.push(toolCall.id);
                return `result-${toolCall.id}`;
            };

            const results = await orchestrator.executeWithDependencies(toolCalls, executor);

            expect(results.size).toBe(2);
            expect(executionOrder).toEqual(['1', '2']); // Sequential order
        });

        it('should handle empty tool calls', async () => {
            const results = await orchestrator.executeWithDependencies([], async () => 'result');
            expect(results.size).toBe(0);
        });

        it('should respect concurrency limit', async () => {
            const toolCalls: ToolCallResult[] = Array.from({ length: 10 }, (_, i) => ({
                id: `${i + 1}`,
                name: 'tool',
                arguments: {},
            }));

            let concurrentCount = 0;
            let maxConcurrent = 0;

            const executor = async (toolCall: ToolCallResult) => {
                concurrentCount++;
                maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                await new Promise(resolve => setTimeout(resolve, 10));
                concurrentCount--;
                return `result-${toolCall.id}`;
            };

            await orchestrator.executeWithDependencies(toolCalls, executor, 3);

            expect(maxConcurrent).toBeLessThanOrEqual(3);
        });
    });
});
