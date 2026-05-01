/**
 * Context Window Example - Summarization Strategy
 * 
 * This example demonstrates using the summarization strategy to condense
 * conversation history into a summary before reaching context limits.
 */

import { Toolpack } from '../src/toolpack';

async function summarizationExample() {
    // Initialize Toolpack with summarization strategy
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        contextWindow: {
            enabled: true,
            strategy: 'summarize', // Use summarization when approaching limits
            pruneThreshold: 80, // Start summarizing at 80% of context window
            maxMessageHistoryLength: 100, // Allow more messages before other pruning
            retainSystemMessages: true,
            // Optional: specify a different model for summarization
            summarizerModel: 'gpt-4', // Use more capable model for summaries
            outputTokenBuffer: 1.15
        }
    });

    const client = toolpack.getClient();

    // Simulate a long conversation that would benefit from summarization
    const messages = [
        {
            role: 'system' as const,
            content: `You are a project management assistant helping a team plan their sprint.
You have expertise in Agile methodologies and project estimation.`
        },
        {
            role: 'user' as const,
            content: 'We need to plan our Q2 roadmap. What should we consider?'
        },
        {
            role: 'assistant' as const,
            content: `For Q2 planning, consider:
1. Stakeholder priorities
2. Team capacity and velocity
3. Dependencies and risks
4. Resource availability
5. Technical debt vs. features
6. User feedback and metrics

Should I help you prioritize specific items?`
        },
        {
            role: 'user' as const,
            content: 'We have 5 feature requests, 3 bug fixes, and significant technical debt.'
        },
        {
            role: 'assistant' as const,
            content: `That's a common challenge. I'd recommend:

Feature Requests (if high-value):
- Estimate effort for each
- Map to business OKRs
- Consider user impact

Bug Fixes:
- Prioritize by severity
- Group related fixes

Technical Debt:
- Define concrete benefits
- Allocate 20-30% of sprint capacity
- Show ROI

What's your current sprint velocity?`
        },
        // Many more messages would follow in a real scenario
        // When the context window approaches the limit, the system will
        // automatically summarize the earlier conversation about roadmap planning,
        // keeping only recent messages and the summary
    ];

    try {
        const response = await client.generate({
            messages,
            model: 'gpt-4',
            temperature: 0.7
        });

        console.log('Response after potential summarization:', response.content);

        // The system automatically handled context window management:
        // - Monitored token usage
        // - When approaching the threshold, summarized older messages
        // - Preserved system message and recent context
        // - Continued the conversation seamlessly

    } catch (error: any) {
        if (error.code === 'SUMMARIZATION_ERROR') {
            console.error('Summarization failed:', error.message);
            console.error('Recovery suggestion:', error.getSuggestedRecovery());
        } else {
            throw error;
        }
    }
}

// Run the example
summarizationExample().catch(console.error);
