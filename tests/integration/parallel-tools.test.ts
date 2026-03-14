import { describe, it, expect, beforeAll } from 'vitest';
import { Toolpack, ToolDefinition, ToolProject, ToolProgressEvent } from '../../src';

// Test configuration from environment
const testConfig = {
    openai: process.env.TOOLPACK_OPENAI_KEY,
};

// Custom tool to test parallel execution timing
const delayTool: ToolDefinition = {
    name: 'test.delay_and_echo',
    displayName: 'Delay and Echo',
    description: 'Waits for a specified duration and returns the echo string. Use this to simulate slow operations.',
    category: 'test',
    parameters: {
        type: 'object',
        properties: {
            delayMs: {
                type: 'number',
                description: 'Milliseconds to wait'
            },
            echo: {
                type: 'string',
                description: 'String to return'
            }
        },
        required: ['echo']
    },
    execute: async (args: any) => {
        const delay = args.delayMs || 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return `Echoed: ${args.echo}`;
    }
};

const testToolProject: ToolProject = {
    manifest: {
        key: 'test',
        name: 'test-parallel',
        displayName: 'Test Parallel Tools',
        description: 'Tools for testing parallel execution',
        version: '1.0.0',
        author: 'Test',
        category: 'test',
        tools: ['test.delay_and_echo']
    },
    tools: [delayTool]
};

describe('Parallel Tool Execution Integration', () => {
    beforeAll(() => {
        if (!testConfig.openai) {
            console.warn('⏭ Skipping OpenAI parallel tool tests - no API key');
        }
    });

    it('should execute multiple tools in parallel in Chat mode', async () => {
        if (!testConfig.openai) return;

        const tc = await Toolpack.init({
            providers: {
                openai: { apiKey: testConfig.openai },
            },
            defaultProvider: 'openai',
            defaultMode: 'agent', // We need a mode that allows the 'test' category, or we need to allow all tools
            tools: false, // DO NOT load built-in tools
            customTools: [testToolProject],
            customModes: [{
                name: 'test_chat',
                displayName: 'Test Chat',
                description: 'Test mode that allows test tools',
                systemPrompt: 'You are a test assistant. You must use the test.delay_and_echo tool.',
                allowedToolCategories: ['test'],
                blockedToolCategories: [],
                allowedTools: [],
                blockedTools: [],
                blockAllTools: false
            }]
        });

        tc.setMode('test_chat');

        const client = tc.getClient();
        expect(client).toBeDefined();

        const toolStartTimes: number[] = [];
        const toolEndTimes: number[] = [];
        const toolCallDetails: Array<{callId: number, startTime: number, endTime: number, duration: number}> = [];

        // Listen to tool events to track execution timing
        client!.on('tool:started', (event: ToolProgressEvent) => {
            if (event.toolName === 'test.delay_and_echo') {
                const startTime = Date.now();
                toolStartTimes.push(startTime);
                toolCallDetails.push({callId: toolStartTimes.length, startTime, endTime: 0, duration: 0});
                console.log(`[Chat Mode] Tool call #${toolStartTimes.length} started at: ${startTime}`);
            }
        });

        client!.on('tool:completed', (event: ToolProgressEvent) => {
            if (event.toolName === 'test.delay_and_echo') {
                const endTime = Date.now();
                toolEndTimes.push(endTime);
                const callIndex = toolEndTimes.length - 1;
                toolCallDetails[callIndex].endTime = endTime;
                toolCallDetails[callIndex].duration = endTime - toolCallDetails[callIndex].startTime;
                console.log(`[Chat Mode] Tool call #${callIndex + 1} ended at: ${endTime} (duration: ${toolCallDetails[callIndex].duration}ms)`);
            }
        });

        // 3 calls with 2000ms delay each -> if sequential, it would take ~6000ms. If parallel, ~2000ms.
        const result = await tc.generate({
            model: 'gpt-4.1', // Use a smart model to ensure it makes multiple tool calls at once
            messages: [
                {
                    role: 'system',
                    content: 'You must use the test.delay_and_echo tool to answer the user. Call the tool exactly 3 times in parallel, right now, to process the 3 inputs provided by the user. Do not call them one by one. Output the combined results.'
                },
                {
                    role: 'user', 
                    content: 'Echo these 3 words using the tool: "Apple", "Banana", "Cherry". Use a 2000ms delay for each.'
                }
            ]
        }, 'openai');

        // Verify the AI gave us the response
        expect(result.content).toBeDefined();
        if (result.content) {
            expect(result.content.toLowerCase()).toContain('apple');
            expect(result.content.toLowerCase()).toContain('banana');
            expect(result.content.toLowerCase()).toContain('cherry');
        }

        // Verify that 3 tools were executed
        expect(toolStartTimes.length).toBe(3);
        expect(toolEndTimes.length).toBe(3);

        // Calculate timing overlaps
        const firstStart = Math.min(...toolStartTimes);
        const lastEnd = Math.max(...toolEndTimes);
        const totalToolExecutionTime = lastEnd - firstStart;

        console.log(`\n[Chat Mode] Tool Execution Summary:`);
        console.log(`  Total execution time: ${totalToolExecutionTime}ms`);
        console.log(`  Expected sequential time: ~6000ms`);
        console.log(`  Expected parallel time: ~2000ms`);
        toolCallDetails.forEach((detail, index) => {
            console.log(`  Tool #${detail.callId}: Started at ${detail.startTime}, Ended at ${detail.endTime}, Duration: ${detail.duration}ms`);
        });
        console.log(`  Parallel execution verified: ${totalToolExecutionTime < 4000 ? 'YES' : 'NO'}\n`);

        // If it was sequential, it would be ~6000ms. 
        // We assert it's less than 4000ms to prove they ran in parallel.
        expect(totalToolExecutionTime).toBeLessThan(4000);
        // And more than 2000ms to prove they actually waited
        expect(totalToolExecutionTime).toBeGreaterThanOrEqual(2000);

    }, 30000);

    it('should execute multiple tools in parallel in Agent (Workflow) mode', async () => {
        if (!testConfig.openai) return;

        const tc = await Toolpack.init({
            providers: {
                openai: { apiKey: testConfig.openai },
            },
            defaultProvider: 'openai',
            defaultMode: 'agent', // Use agent mode
            tools: false, // DO NOT load built-in tools
            customTools: [testToolProject],
            customModes: [{
                name: 'test_agent',
                displayName: 'Test Agent',
                description: 'Test agent mode that allows test tools',
                systemPrompt: 'You are a test assistant.',
                allowedToolCategories: ['test'],
                blockedToolCategories: [],
                allowedTools: [],
                blockedTools: [],
                blockAllTools: false,
                workflow: {
                    planning: { enabled: true },
                    steps: { enabled: true }
                }
            }]
        });

        tc.setMode('test_agent');

        const client = tc.getClient();
        expect(client).toBeDefined();

        const toolStartTimes: number[] = [];
        const toolEndTimes: number[] = [];
        const toolCallDetails: Array<{callId: number, startTime: number, endTime: number, duration: number}> = [];

        client!.on('tool:started', (event: ToolProgressEvent) => {
            if (event.toolName === 'test.delay_and_echo') {
                const startTime = Date.now();
                toolStartTimes.push(startTime);
                toolCallDetails.push({callId: toolStartTimes.length, startTime, endTime: 0, duration: 0});
                console.log(`[Agent Mode] Tool call #${toolStartTimes.length} started at: ${startTime}`);
            }
        });

        client!.on('tool:completed', (event: ToolProgressEvent) => {
            if (event.toolName === 'test.delay_and_echo') {
                const endTime = Date.now();
                toolEndTimes.push(endTime);
                const callIndex = toolEndTimes.length - 1;
                toolCallDetails[callIndex].endTime = endTime;
                toolCallDetails[callIndex].duration = endTime - toolCallDetails[callIndex].startTime;
                console.log(`[Agent Mode] Tool call #${callIndex + 1} ended at: ${endTime} (duration: ${toolCallDetails[callIndex].duration}ms)`);
            }
        });

        // Agent mode uses WorkflowExecutor
        const executor = tc.getWorkflowExecutor();
        expect(executor).toBeDefined();

        const result = await executor!.execute({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'user',
                    content: 'Create a plan with a single step. In that step, call the test.delay_and_echo tool exactly 3 times in parallel for the words "Red", "Green", and "Blue", with a 2000ms delay each. Then summarize the echoed results.'
                }
            ]
        });

        // Verify the output
        expect(result.output).toBeDefined();
        if (result.output) {
            expect(result.output.toLowerCase()).toContain('red');
            expect(result.output.toLowerCase()).toContain('green');
            expect(result.output.toLowerCase()).toContain('blue');
        }

        // Verify tools were called
        expect(toolStartTimes.length).toBeGreaterThanOrEqual(3);
        
        // Calculate timing
        const firstStart = Math.min(...toolStartTimes);
        const lastEnd = Math.max(...toolEndTimes);
        const totalToolExecutionTime = lastEnd - firstStart;

        console.log(`\n[Agent Mode] Tool Execution Summary:`);
        console.log(`  Total execution time: ${totalToolExecutionTime}ms`);
        console.log(`  Expected sequential time: ~6000ms`);
        console.log(`  Expected parallel time: ~2000ms`);
        toolCallDetails.forEach((detail, index) => {
            console.log(`  Tool #${detail.callId}: Started at ${detail.startTime}, Ended at ${detail.endTime}, Duration: ${detail.duration}ms`);
        });
        console.log(`  Parallel execution verified: ${totalToolExecutionTime < 4000 ? 'YES' : 'NO'}\n`);

        // If it was sequential, it would be >= 6000ms. 
        expect(totalToolExecutionTime).toBeLessThan(4000);
        expect(totalToolExecutionTime).toBeGreaterThanOrEqual(2000);

    }, 60000); // Give agent mode a bit more time as it has to plan first
});
