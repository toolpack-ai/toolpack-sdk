/**
 * Tool Orchestrator for Smart Parallel & Sequential Execution
 * 
 * Analyzes tool call dependencies and executes independent tools in parallel
 * while respecting dependencies for sequential execution.
 */

import { ToolCallResult } from '../types';

export interface ToolDependency {
    toolCallId: string;
    dependsOn: string[]; // IDs of tools this depends on
}

export class ToolOrchestrator {
    /**
     * Analyze tool calls to detect dependencies.
     * Two tools are dependent if one uses the output of another.
     */
    analyzeDependencies(toolCalls: ToolCallResult[]): ToolDependency[] {
        const dependencies: ToolDependency[] = [];
        
        for (let i = 0; i < toolCalls.length; i++) {
            const current = toolCalls[i];
            const dependsOn: string[] = [];
            
            // Check if current tool's args reference previous tools
            const argsStr = JSON.stringify(current.arguments).toLowerCase();
            
            for (let j = 0; j < i; j++) {
                const previous = toolCalls[j];
                
                // Heuristics for dependency detection:
                // 1. File path dependency (fs.read_file depends on fs.search result)
                // 2. Same resource (multiple operations on same file)
                // 3. Explicit reference (args contain previous tool name)
                
                if (this.hasDependency(current, previous, argsStr)) {
                    dependsOn.push(previous.id);
                }
            }
            
            dependencies.push({ toolCallId: current.id, dependsOn });
        }
        
        return dependencies;
    }
    
    /**
     * Check if current tool depends on previous tool.
     */
    private hasDependency(current: ToolCallResult, previous: ToolCallResult, currentArgsStr: string): boolean {
        // Same file path (fs tools)
        if (current.arguments.path && previous.arguments.path && 
            current.arguments.path === previous.arguments.path) {
            return true;
        }
        
        // Same file_path (coding tools)
        if (current.arguments.file_path && previous.arguments.file_path && 
            current.arguments.file_path === previous.arguments.file_path) {
            return true;
        }
        
        // Same filePath (alternative naming)
        if (current.arguments.filePath && previous.arguments.filePath && 
            current.arguments.filePath === previous.arguments.filePath) {
            return true;
        }
        
        // Write after read on same resource
        const writeTools = ['fs.write_file', 'fs.delete_file', 'fs.move', 'fs.copy', 'fs.replace_in_file', 'fs.append_file'];
        if (writeTools.includes(current.name) && previous.arguments.path && 
            currentArgsStr.includes(previous.arguments.path.toLowerCase())) {
            return true;
        }
        
        // Command execution dependencies (exec.run_background → exec.read_output)
        if (current.name === 'exec.read_output' && previous.name === 'exec.run_background') {
            return true;
        }
        
        // HTTP download dependencies (http.get → http.download)
        if (current.name === 'http.download' && previous.name === 'http.get' && 
            previous.arguments.url && currentArgsStr.includes(previous.arguments.url.toLowerCase())) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Execute tools respecting dependencies.
     * Independent tools run in parallel, dependent tools wait.
     * 
     * @param toolCalls - Array of tool calls to execute
     * @param executor - Function to execute a single tool call
     * @param maxConcurrent - Maximum number of parallel executions (default: 5)
     * @returns Map of tool call ID to result
     */
    async executeWithDependencies(
        toolCalls: ToolCallResult[],
        executor: (toolCall: ToolCallResult) => Promise<string>,
        maxConcurrent: number = 5
    ): Promise<Map<string, string>> {
        if (toolCalls.length === 0) {
            return new Map();
        }
        
        const dependencies = this.analyzeDependencies(toolCalls);
        const results = new Map<string, string>();
        const completed = new Set<string>();
        
        // Build execution batches (tools with no pending dependencies)
        while (completed.size < toolCalls.length) {
            const batch: ToolCallResult[] = [];
            
            for (const toolCall of toolCalls) {
                if (completed.has(toolCall.id)) continue;
                
                const dep = dependencies.find(d => d.toolCallId === toolCall.id);
                const allDepsCompleted = dep?.dependsOn.every(id => completed.has(id)) ?? true;
                
                if (allDepsCompleted) {
                    batch.push(toolCall);
                }
            }
            
            if (batch.length === 0) {
                // Circular dependency detected
                const remaining = toolCalls.filter(tc => !completed.has(tc.id));
                throw new Error(`Circular dependency detected in tool calls: ${remaining.map(tc => tc.name).join(', ')}`);
            }
            
            // Execute batch in parallel (with concurrency limit)
            const batchResults = await this.executeBatchWithLimit(batch, executor, maxConcurrent);
            
            // Record results
            for (const { id, result } of batchResults) {
                results.set(id, result);
                completed.add(id);
            }
        }
        
        return results;
    }
    
    /**
     * Execute a batch of tools with a concurrency limit.
     */
    private async executeBatchWithLimit(
        batch: ToolCallResult[],
        executor: (toolCall: ToolCallResult) => Promise<string>,
        maxConcurrent: number
    ): Promise<Array<{ id: string; result: string }>> {
        const results: Array<{ id: string; result: string }> = [];
        
        // If batch is smaller than limit, execute all in parallel
        if (batch.length <= maxConcurrent) {
            const batchPromises = batch.map(async (toolCall) => {
                const result = await executor(toolCall);
                return { id: toolCall.id, result };
            });
            return await Promise.all(batchPromises);
        }
        
        // Otherwise, execute in chunks
        for (let i = 0; i < batch.length; i += maxConcurrent) {
            const chunk = batch.slice(i, i + maxConcurrent);
            const chunkPromises = chunk.map(async (toolCall) => {
                const result = await executor(toolCall);
                return { id: toolCall.id, result };
            });
            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }
        
        return results;
    }
    
    /**
     * Check if parallel execution would benefit this set of tool calls.
     * Returns true if there are at least 2 independent tools.
     */
    shouldUseParallelExecution(toolCalls: ToolCallResult[]): boolean {
        if (toolCalls.length < 2) {
            return false;
        }
        
        const dependencies = this.analyzeDependencies(toolCalls);
        
        // Count tools with no dependencies
        const independentCount = dependencies.filter(d => d.dependsOn.length === 0).length;
        
        // Use parallel if we have at least 2 independent tools
        return independentCount >= 2;
    }
}
