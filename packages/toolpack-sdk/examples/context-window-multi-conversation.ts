/**
 * Context Window Example - Multi-Conversation Tracking
 * 
 * This example demonstrates managing context windows for multiple
 * concurrent conversations with different users or threads.
 */

import { Toolpack } from '../src/toolpack';

/**
 * Represents a single user conversation
 */
interface UserConversation {
    userId: string;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
}

async function multiConversationExample() {
    // Initialize Toolpack with context window management
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        contextWindow: {
            enabled: true,
            strategy: 'prune',
            pruneThreshold: 85,
            maxMessageHistoryLength: 50,
            retainSystemMessages: true,
            outputTokenBuffer: 1.15
        }
    });

    // Simulated conversations with different users
    const conversations: Record<string, UserConversation> = {
        'user-001': {
            userId: 'user-001',
            conversationId: 'conv-001-support',
            messages: [
                {
                    role: 'system',
                    content: 'You are a customer support assistant.'
                }
            ]
        },
        'user-002': {
            userId: 'user-002',
            conversationId: 'conv-002-sales',
            messages: [
                {
                    role: 'system',
                    content: 'You are a sales assistant helping customers find products.'
                }
            ]
        },
        'user-003': {
            userId: 'user-003',
            conversationId: 'conv-003-technical',
            messages: [
                {
                    role: 'system',
                    content: 'You are a technical support specialist.'
                }
            ]
        }
    };

    // Process each user's conversation
    for (const [userId, conv] of Object.entries(conversations)) {
        await processUserConversation(toolpack, conv);
    }

    // Example: Generate stats for all conversations
    console.log('\n=== Conversation Summary ===');
    for (const [userId, conv] of Object.entries(conversations)) {
        console.log(`${userId} (${conv.conversationId}): ${conv.messages.length} messages`);
    }
}

async function processUserConversation(
    toolpack: any,
    conversation: UserConversation
) {
    console.log(`\nProcessing ${conversation.userId}...`);

    // Create a new client instance for this conversation with specific ID
    const client = toolpack.getClient(conversation.conversationId);

    // Add some user messages
    conversation.messages.push({
        role: 'user',
        content: `Hello, I have a question about your service for user ${conversation.userId}`
    });

    try {
        // Generate response for this conversation
        const response = await client.generate({
            messages: conversation.messages as any,
            model: 'gpt-4',
            temperature: 0.7
        });

        // Add assistant response to history
        conversation.messages.push({
            role: 'assistant',
            content: response.content || ''
        });

        console.log(`  ✓ Response generated (${conversation.messages.length} total messages)`);

    } catch (error: any) {
        console.error(`  ✗ Error for ${conversation.userId}:`, error.message);

        // Handle specific errors per conversation
        if (error.code === 'CONTEXT_WINDOW_EXCEEDED') {
            console.log(`  → Context window exceeded, archiving old messages`);
            // Archive mechanism would go here
        }
    }
}

/**
 * Advanced: Context Window Manager for Multiple Conversations
 */
class MultiConversationContextManager {
    private conversations: Map<string, UserConversation> = new Map();
    private toolpack: any;
    private maxConversations: number = 10;
    private tokenBudget: number = 500000; // Total tokens for all conversations

    constructor(toolpack: any) {
        this.toolpack = toolpack;
    }

    /**
     * Start a new conversation
     */
    startConversation(userId: string, systemPrompt: string): string {
        const conversationId = `conv-${Date.now()}-${userId}`;

        this.conversations.set(conversationId, {
            userId,
            conversationId,
            messages: [{ role: 'system', content: systemPrompt }]
        });

        if (this.conversations.size > this.maxConversations) {
            this.pruneInactiveConversations();
        }

        return conversationId;
    }

    /**
     * Add message to conversation
     */
    addMessage(conversationId: string, role: string, content: string) {
        const conv = this.conversations.get(conversationId);
        if (conv) {
            conv.messages.push({ role, content });
        }
    }

    /**
     * Generate response for conversation
     */
    async generateResponse(conversationId: string): Promise<string> {
        const conv = this.conversations.get(conversationId);
        if (!conv) throw new Error(`Conversation ${conversationId} not found`);

        const client = this.toolpack.getClient(conversationId);

        const response = await client.generate({
            messages: conv.messages as any,
            model: 'gpt-4',
            temperature: 0.7
        });

        // Add assistant message
        this.addMessage(conversationId, 'assistant', response.content || '');

        return response.content || '';
    }

    /**
     * Remove old/inactive conversations to free resources
     */
    private pruneInactiveConversations() {
        // Sort by message count (less recent assumed to be older)
        const sorted = Array.from(this.conversations.values())
            .sort((a, b) => a.messages.length - b.messages.length);

        // Remove oldest conversation
        if (sorted.length > 0) {
            const toRemove = sorted[0];
            this.conversations.delete(toRemove.conversationId);
            console.log(`Archived conversation ${toRemove.conversationId}`);
        }
    }

    /**
     * Get manager statistics
     */
    getStats() {
        let totalMessages = 0;
        let totalTokens = 0;

        for (const conv of this.conversations.values()) {
            totalMessages += conv.messages.length;
            // Rough token estimate
            totalTokens += conv.messages.reduce((sum, msg) => {
                return sum + Math.ceil((msg.role.length + msg.content.length) / 4);
            }, 0);
        }

        return {
            activeConversations: this.conversations.size,
            totalMessages,
            estimatedTokens: totalTokens,
            budgetUsage: Math.round((totalTokens / this.tokenBudget) * 100)
        };
    }
}

// Advanced example usage
async function advancedMultiConversationExample() {
    const toolpack = await Toolpack.init({
        provider: 'openai',
        providers: {
            openai: {
                apiKey: process.env.OPENAI_API_KEY
            }
        },
        contextWindow: {
            enabled: true,
            strategy: 'prune'
        }
    });

    const manager = new MultiConversationContextManager(toolpack);

    // Start multiple conversations
    const conv1 = manager.startConversation('user-a', 'You are a helpful assistant.');
    const conv2 = manager.startConversation('user-b', 'You are a technical expert.');

    // Add messages
    manager.addMessage(conv1, 'user', 'What is AI?');
    manager.addMessage(conv2, 'user', 'How do neural networks work?');

    // Generate responses
    try {
        const resp1 = await manager.generateResponse(conv1);
        console.log('Response 1:', resp1.substring(0, 100) + '...');

        const resp2 = await manager.generateResponse(conv2);
        console.log('Response 2:', resp2.substring(0, 100) + '...');
    } catch (error) {
        console.error('Error generating responses:', error);
    }

    // Print stats
    console.log('\n=== Manager Stats ===');
    console.log(manager.getStats());
}

// Run examples
(async () => {
    console.log('=== Multi-Conversation Example ===\n');
    try {
        await multiConversationExample();
    } catch (error) {
        console.error('Error:', error);
    }

    console.log('\n\n=== Advanced Multi-Conversation Example ===\n');
    try {
        await advancedMultiConversationExample();
    } catch (error) {
        console.error('Error:', error);
    }
})();
