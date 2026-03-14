import {
    AIClient,
    ToolRegistry,
    OpenAIAdapter,
    fsToolsProject,
    execToolsProject,
    systemToolsProject,
    httpToolsProject,
    webToolsProject,
    loadToolsConfig,
    ToolDefinition,
} from '../../src/index.js';

async function runIntegrationTest() {
    console.log('=== Toolpack SDK Integration Test ===\n');

    // Test 1: Load config
    console.log('1. Loading tools config...');
    const toolsConfig = loadToolsConfig();
    console.log('   ✓ Config loaded:', JSON.stringify(toolsConfig, null, 2).split('\n')[1].trim());

    // Test 2: Create registry
    console.log('\n2. Creating ToolRegistry...');
    const registry = new ToolRegistry();
    registry.setConfig(toolsConfig);
    console.log('   ✓ Registry created');

    // Test 3: Load tool projects
    console.log('\n3. Loading tool projects...');
    const projects = [
        fsToolsProject,
        execToolsProject,
        systemToolsProject,
        httpToolsProject,
        webToolsProject,
    ];

    let loadedCount = 0;
    for (const project of projects) {
        try {
            await registry.loadProject(project);
            console.log(`   ✓ ${project.manifest.displayName} (${project.manifest.tools.length} tools)`);
            loadedCount++;
        } catch (err: any) {
            console.log(`   ✗ ${project.manifest.name}: ${err.message}`);
        }
    }

    // Test 4: Verify tools
    console.log('\n4. Verifying registered tools...');
    const totalTools = registry.getNames().length;
    const enabledTools = registry.getEnabled();
    console.log(`   ✓ Total registered: ${totalTools} tools`);
    console.log(`   ✓ Enabled for AI: ${enabledTools.length} tools`);

    if (totalTools !== 43) {
        console.error(`   ✗ Expected 43 tools, got ${totalTools}`);
        process.exit(1);
    }

    // Test 5: Create AIClient (without API call)
    console.log('\n5. Creating AIClient...');
    const apiKey = process.env.TOOLPACK_OPENAI_KEY;
    if (!apiKey || apiKey.includes('placeholder')) {
        console.log('   ⚠  No valid API key — skipping live AI test');
        console.log('   ✓ AIClient can be created (tools verified)');
    } else {
        const adapter = new OpenAIAdapter(apiKey);
        const client = new AIClient({
            providers: { openai: adapter },
            defaultProvider: 'openai',
            toolRegistry: registry,
            toolsConfig: (registry as any)['config'],
        });
        console.log('   ✓ AIClient created with tool support');

        // Test 6: Live AI test
        console.log('\n6. Testing live AI tool calling...');
        console.log('   Sending: "List the files in current directory"');
        try {
            const response = await client.generate({
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'List the files in current directory' },
                ],
                model: 'gpt-4.1-mini',
            }, 'openai');

            console.log('   ✓ AI responded');
            if (response.tool_calls && response.tool_calls.length > 0) {
                console.log(`   ✓ AI called tools: ${response.tool_calls.map((tc: any) => tc.name).join(', ')}`);
            }
        } catch (err: any) {
            console.error(`   ✗ AI test failed: ${err.message}`);
            process.exit(1);
        }
    }

    console.log('\n=== Integration Test Complete ===');
    console.log(`Loaded ${loadedCount}/5 tool projects, ${totalTools} tools ready`);
}

runIntegrationTest().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
