import { createToolProject, ToolDefinition, Toolpack } from 'toolpack';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables for the example
dotenv.config();

/**
 * 1. Define Individual Tools
 * 
 * Each tool implements the `ToolDefinition` interface. It describes
 * what the tool does, accepts a JSON schema for its parameters,
 * and provides an `execute` block.
 */
const myGreetTool: ToolDefinition = {
    name: 'my-project.greet',
    displayName: 'Greet User',
    description: 'Returns a personalized greeting message',
    category: 'custom',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
    },
    execute: async (args, ctx) => {
        // You can log messages that appear in toolpack-sdk.log
        ctx?.log(`Executing greeting for ${args.name}`);

        // You have access to the workspaceRoot path
        const workingDir = ctx?.workspaceRoot ?? 'unknown directory';

        return `Hello, ${args.name}! I am executing this tool inside ${workingDir}.`;
    },
};

/**
 * 2. Bundle into a Tool Project
 * 
 * The `createToolProject` factory generates a fully-compliant
 * ToolProject structure that can be loaded into Toolpack's ToolRegistry.
 */
export const myCustomTools = createToolProject({
    key: 'my-custom-tools',
    name: 'My Custom Tools',
    displayName: 'My Custom Tools Package',
    version: '1.0.0',
    description: 'Example of how to build and register a custom tool project.',
    category: 'custom',
    author: 'Developer',
    tools: [myGreetTool],
});

/**
 * 3. Usage inside Toolpack
 */
async function runExample() {
    console.log('--- Initializing Toolpack with Custom Tools ---');

    // Method A: Register at init-time
    const sdk = await Toolpack.init({
        provider: 'openai',
        tools: true, // Loads built-in tools (fs, http, exec, etc.)
        customTools: [myCustomTools], // Inject our newly defined project here
    });

    console.log('\n--- Using the AI to call the custom tool ---');

    const response = await sdk.generate("Please generate a greeting for Alice using the my-project.greet tool.");

    console.log('AI Response:', response.content);

    // Method B: Register dynamically at runtime
    // await sdk.loadToolProject(myOtherCustomTools);
}

// Run the example
runExample().catch(console.error);
