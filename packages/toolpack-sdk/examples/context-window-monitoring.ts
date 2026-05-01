/**
 * Context Window Example - State Monitoring and Fail Strategy
 * 
 * This example demonstrates how to monitor context window state and use
 * the fail strategy to prevent requests from being sent with excessive context.
 */

import { Toolpack } from '../src/toolpack';
import { AIClient } from '../src/client';

async function stateMonitoringExample() {
    // Initialize Toolpack with fail strategy for safety
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        conversationId: 'user-123-session', // Track conversation for state management
        contextWindow: {
            enabled: true,
            strategy: 'fail', // Fail rather than silently drop context
            pruneThreshold: 90, // Alert at 90%, fail at 100%
            outputTokenBuffer: 1.20,
            retainSystemMessages: true
        }
    });

    const client = toolpack.getClient();

    // Example messages that will accumulate
    const messages = [
        {
            role: 'system' as const,
            content: 'You are an expert data analyst providing insights.'
        }
    ];

    // Simulate adding many messages to the conversation
    for (let i = 0; i < 10; i++) {
        messages.push({
            role: 'user' as const,
            content: `Question ${i}: Analyze this data point - ${generateSampleData()}`
        });

        messages.push({
            role: 'assistant' as const,
            content: `Analysis ${i}: Based on the provided data, the key insights are...`
        });
    }

    // Now attempt to generate response with potentially high token count
    try {
        const response = await client.generate({
            messages,
            model: 'gpt-4',
            temperature: 0.5
        });

        console.log('Response:', response.content);

    } catch (error: any) {
        // Handle context window errors with fail strategy
        if (error.code === 'CONTEXT_WINDOW_EXCEEDED') {
            console.error('Context window exceeded!');
            console.error('Conversation ID:', error.conversationId);
            console.error('Current tokens:', error.currentTokens);
            console.error('Limit:', error.contextWindowLimit);
            console.error('Overage:', error.getOverageTokens(), 'tokens');
            console.error('Usage:', error.getUsagePercentage() + '%');

            // Strategies for recovery:
            console.log('\nRecovery options:');
            console.log('1. Archive old messages from the conversation');
            console.log('2. Start a new conversation');
            console.log('3. Reduce context with manual pruning');

            // Example: Implement manual recovery
            console.log('\nStarting fresh conversation...');
            // Reset messages to system + last few exchanges
            const freshMessages = [
                messages[0], // System message
                messages[messages.length - 2], // Last user message
                messages[messages.length - 1]  // Last assistant response
            ];

            // Try again with reduced context
            const recoveryResponse = await client.generate({
                messages: freshMessages,
                model: 'gpt-4'
            });

            console.log('Recovery response:', recoveryResponse.content);
        } else {
            throw error;
        }
    }
}

/**
 * Alternative: Manual State Monitoring
 * Use this when you need fine-grained control over context window management
 */
async function manualStateMonitoringExample() {
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        conversationId: 'monitored-session',
        contextWindow: {
            enabled: true,
            strategy: 'prune'
        }
    });

    const client = toolpack.getClient();

    // Get reference to state manager if available
    const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' }
    ];

    // Make a request
    let response = await client.generate({
        messages,
        model: 'gpt-4'
    });

    console.log('Generation succeeded:', response.content ? response.content.substring(0, 50) + '...' : 'empty');

    // In a real scenario, you might want to:
    // 1. Track token usage over time
    // 2. Alert when approaching limits
    // 3. Implement proactive cleanup
    // 4. Monitor multiple conversations

    return response;
}

function generateSampleData(): string {
    return JSON.stringify({
        metric: 'revenue',
        value: Math.floor(Math.random() * 100000),
        date: new Date().toISOString().split('T')[0]
    });
}

// Run examples
(async () => {
    console.log('=== State Monitoring Example ===\n');
    try {
        await stateMonitoringExample();
    } catch (error) {
        console.error('Error in state monitoring example:', error);
    }

    console.log('\n\n=== Manual State Monitoring Example ===\n');
    try {
        await manualStateMonitoringExample();
    } catch (error) {
        console.error('Error in manual monitoring example:', error);
    }
})();
