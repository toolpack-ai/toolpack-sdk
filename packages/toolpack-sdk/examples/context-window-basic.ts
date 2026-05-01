/**
 * Basic Context Window Example - Pruning Strategy
 * 
 * This example demonstrates the basic usage of context window management
 * with the prune strategy, which removes oldest messages when approaching limits.
 */

import { Toolpack } from '../src/toolpack';

async function basicPruningExample() {
    // Initialize Toolpack with context window configuration
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        contextWindow: {
            enabled: true,
            strategy: 'prune', // Remove old messages automatically
            pruneThreshold: 85, // Start pruning at 85% of context window
            maxMessageHistoryLength: 50, // Keep at most 50 messages
            retainSystemMessages: true, // Always keep system prompts
            outputTokenBuffer: 1.15 // Reserve 15% for output
        }
    });

    // Get the AI client instance
    const client = toolpack.getClient();

    // Example conversation with many messages
    const messages = [
        {
            role: 'system' as const,
            content: 'You are a helpful coding assistant. Provide clear, concise answers.'
        },
        {
            role: 'user' as const,
            content: 'What is the difference between let and const in JavaScript?'
        },
        {
            role: 'assistant' as const,
            content: `let and const are both block-scoped variables introduced in ES6:

- let: Can be reassigned, is mutable
- const: Cannot be reassigned, creates immutable reference

Example:
let x = 1;
x = 2; // OK

const y = 1;
y = 2; // Error: Assignment to constant variable`
        },
        {
            role: 'user' as const,
            content: 'Can you provide more examples?'
        },
        {
            role: 'assistant' as const,
            content: 'Sure! Here are more examples...'
        }
        // ... more messages would be pruned automatically if needed
    ];

    // Generate a response - context window is managed automatically
    const response = await client.generate({
        messages,
        model: 'gpt-4',
        temperature: 0.7
    });

    console.log('Assistant response:', response.content);
}

// Run the example
basicPruningExample().catch(console.error);
