# Toolpack SDK

A unified TypeScript/Node.js SDK for building AI-powered applications with multiple providers, 97 built-in tools, a workflow engine, and a flexible mode system — all through a single API.

[![npm version](https://img.shields.io/npm/v/toolpack-sdk.svg)](https://www.npmjs.com/package/toolpack-sdk)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Website:** [https://toolpacksdk.com](https://toolpacksdk.com)

## Features

- **Unified API** — Single interface for OpenAI, Anthropic, Google Gemini, Ollama, OpenRouter, and custom providers
- **Streaming** — Real-time response streaming across all providers
- **Type-Safe** — Comprehensive TypeScript types throughout
- **Multimodal** — Text and image inputs (vision) across all providers
- **Embeddings** — Vector generation for RAG applications (OpenAI, Gemini, Ollama)
- **Workflow Engine** — AI-driven planning and step-by-step task execution with progress events
- **Mode System** — Built-in Agent and Chat modes, plus `createMode()` for custom modes with tool filtering
- **HITL Confirmation** — Human-in-the-loop approval for high-risk operations with configurable bypass rules
- **Custom Providers** — Bring your own provider by implementing the `ProviderAdapter` interface
- **97 Built-in Tools** across 12 categories:
- **MCP Tool Server Integration** — dynamically bridge external Model Context Protocol servers into Toolpack as first-class tools via `createMcpToolProject()` and `disconnectMcpToolProject()`.

| Category | Tools | Description |
|----------|-------|-------------|
| **`fs-tools`** | 18 | File system operations — read, write, search, tree, glob, batch read/write, etc. |
| **`coding-tools`** | 12 | Code analysis — AST parsing, go to definition, find references, rename symbols, extract function |
| **`git-tools`** | 9 | Version control — status, diff, log, blame, branch, commit, checkout |
| **`db-tools`** | 7 | Database operations — query, schema, tables, count, insert, update, delete (SQLite, PostgreSQL, MySQL) |
| **`exec-tools`** | 6 | Command execution — run, run shell, background processes, kill, read output |
| **`http-tools`** | 5 | HTTP requests — GET, POST, PUT, DELETE, download |
| **`web-tools`** | 9 | Web interaction — fetch, search (Tavily/Brave/DuckDuckGo), scrape, extract links, map, metadata, sitemap, feed, screenshot |
| **`system-tools`** | 5 | System info — env vars, cwd, disk usage, system info, set env |
| **`github-tools`** | 9 | GitHub operations — PR reviews, review threads, file diffs, issue comments, GraphQL, repo contents |
| **`diff-tools`** | 3 | Patch operations — create, apply, and preview diffs |
| **`cloud-tools`** | 3 | Deployments — deploy, status, list (via Netlify) |
| **`k8s-tools`** | 11 | Kubernetes cluster inspection and management via kubectl |
| **`mcp-tools`** | 2 | MCP integration — createMcpToolProject, disconnectMcpToolProject |

## Quick Start

### Prerequisites

- **Node.js >= 20** is required

### Installation

```bash
npm install toolpack-sdk
```

### Basic Usage

```typescript
import { Toolpack } from 'toolpack-sdk';

// Initialize with one or more providers
const sdk = await Toolpack.init({
  providers: {
    openai: {},      // Reads OPENAI_API_KEY from env
    anthropic: {},   // Reads ANTHROPIC_API_KEY from env
  },
  defaultProvider: 'openai',
  tools: true,         // Load all 97 built-in tools
  defaultMode: 'agent', // Agent mode with workflow engine
});

// Generate a completion
const response = await sdk.generate('What is the capital of France?');
console.log(response.content);

// Stream a response
for await (const chunk of sdk.stream({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Tell me a story' }],
})) {
  process.stdout.write(chunk.delta);
}

// Switch providers on the fly
const anthropicResponse = await sdk.generate({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Hello from Anthropic!' }],
}, 'anthropic');
```

### Single Provider Shorthand

```typescript
const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
});
```

## Kubernetes Tools

Toolpack SDK now includes a dedicated Kubernetes tool category that exposes `kubectl`-backed operations when `tools: true` is enabled. Use these tools to inspect cluster state, fetch pod logs, apply manifests, and wait for rollout status.

```typescript
const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
  defaultMode: 'agent',
});

const podsResponse = await sdk.generate({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'List pods in the default namespace using Kubernetes tools.',
    },
  ],
});
console.log(podsResponse.content);

const applyResponse = await sdk.generate({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'Apply the manifest at ./deploy/my-app.yaml to the staging namespace using Kubernetes tools.',
    },
  ],
});
console.log(applyResponse.content);
```

> Requires `kubectl` installed and configured with a valid kubeconfig.

See `packages/toolpack-sdk/docs/examples/kubernetes-usage.ts` for a complete example.

## Providers

### Built-in Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | GPT-4.1 Mini, GPT-4.1, GPT-5.1, GPT-5.2, GPT-5.4, GPT-5.4 Pro | Full support including reasoning models |
| **Anthropic** | Claude Sonnet 4, Claude 3.5 Haiku, Claude 3 Opus | No embeddings support |
| **Google Gemini** | Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash | Synthetic tool call IDs |
| **Ollama** | Auto-discovered from locally pulled models | Capability detection via probing |
| **OpenRouter** | All models at openrouter.ai (auto-discovered) | Access to 300+ models via OpenAI-compatible API |

### Provider Comparison

| Capability | OpenAI | Anthropic | Gemini | Ollama | OpenRouter |
|------------|--------|-----------|--------|--------|------------|
| Chat completions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tool/function calling | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-round tool loop | ✅ | ✅ | ✅ | ✅ | ✅ |
| Embeddings | ✅ | ❌ | ✅ | ✅ | ❌ |
| Vision/images | ✅ | ✅ | ✅ | ✅ (model-dependent) | ✅ (model-dependent) |
| Tool name sanitization | ✅ (auto) | ✅ (auto) | ✅ (auto) | ✅ (auto) | ✅ (auto) |
| Model discovery | Static list | Static list | Static list | Dynamic (`/api/tags` + `/api/show`) | Dynamic (`/models` endpoint) |

#### Provider-Specific Notes

- **OpenAI**: Supports `reasoningTier` and `costTier` on model info for GPT-5.x reasoning models. API key read from `OPENAI_API_KEY` or `TOOLPACK_OPENAI_KEY`.
- **Anthropic**: Does not support embeddings. Tool results are converted to `tool_result` content blocks automatically. `tool_choice: none` is handled by omitting tools from the request. `max_tokens` defaults to `4096` if not specified. API key read from `ANTHROPIC_API_KEY` or `TOOLPACK_ANTHROPIC_KEY`.

## MCP Tool Server Support

Toolpack now includes first-class support for Model Context Protocol (MCP) adapters and server tool discovery.

### Quick MCP Setup

```typescript
import { Toolpack } from 'toolpack-sdk';
import { createMcpToolProject } from './tools/mcp-tools';

const mcpToolProject = await createMcpToolProject({
  servers: [
    {
      name: 'filesystem',
      displayName: 'MCP Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
      autoConnect: true,
    },
    {
      name: 'custom',
      displayName: 'Custom MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-tools'],
      autoConnect: true,
    },
  ],
});

const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
  customTools: [mcpToolProject],
});

// On shutdown/cold path:
// await disconnectMcpToolProject(mcpToolProject);
```

See `docs/MCP_INTEGRATION.md` and `docs/examples/mcp-integration-example.ts` for full instructions and best practices.
- **Gemini**: Uses synthetic tool call IDs (`gemini_<timestamp>_<random>`) since the Gemini API doesn't return tool call IDs natively. Tool results are converted to `functionResponse` parts in chat history automatically. API key read from `GOOGLE_GENERATIVE_AI_KEY` or `TOOLPACK_GEMINI_KEY`.
- **Ollama**: Auto-discovers all locally pulled models when registered as `{ ollama: {} }`. Uses `/api/show` and tool probing to detect capabilities (tool calling, vision, embeddings) per model. Models without tool support are automatically stripped of tools and given a system instruction to prevent hallucinated tool usage. Uses synthetic tool call IDs (`ollama_<timestamp>_<random>`). Embeddings use the modern `/api/embed` batch endpoint. Legacy per-model registration (`{ 'ollama-llama3': {} }`) is also supported.
- **OpenRouter**: Routes requests to any of the 300+ models available on [openrouter.ai](https://openrouter.ai) via an OpenAI-compatible API. Models are discovered dynamically from the `/models` endpoint. Tool calling is fully supported; models that reject `tool_choice: 'none'` have tools stripped gracefully instead. No embeddings support. Optional `siteUrl` and `siteName` config for OpenRouter's attribution leaderboard. API key read from `OPENROUTER_API_KEY` or `TOOLPACK_OPENROUTER_KEY`.

### Custom Providers

Bring your own provider (e.g., xAI/Grok, Cohere, Mistral) by extending `ProviderAdapter`:

```typescript
import { Toolpack, ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo } from 'toolpack-sdk';

class XAIAdapter extends ProviderAdapter {
  name = 'xai';

  getDisplayName(): string { return 'xAI'; }
  async getModels(): Promise<ProviderModelInfo[]> { return [/* ... */]; }
  async generate(req: CompletionRequest): Promise<CompletionResponse> { /* ... */ }
  async *stream(req: CompletionRequest): AsyncGenerator<CompletionChunk> { /* ... */ }
  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> { /* ... */ }
}

// Pass as array or record
const sdk = await Toolpack.init({
  providers: { openai: {} },
  customProviders: [new XAIAdapter()],
  // or: customProviders: { xai: new XAIAdapter() }
});

// Use it
const response = await sdk.generate('Hello!', 'xai');
```

### Discovering Providers & Models

```typescript
// Nested list of all providers and their models
const providers = await sdk.listProviders();
// [
//   {
//     name: 'openai',
//     displayName: 'OpenAI',
//     type: 'built-in',
//     models: [
//       {
//         id: 'gpt-4.1',
//         displayName: 'GPT-4.1',
//         capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
//         contextWindow: 1047576,
//         maxOutputTokens: 32768,
//         inputModalities: ['text', 'image'],
//         outputModalities: ['text'],
//         reasoningTier: null,
//         costTier: 'medium',
//       },
//       ...
//     ]
//   },
//   { name: 'ollama', displayName: 'Ollama', type: 'built-in', models: [...] },
//   { name: 'xai', displayName: 'xAI', type: 'custom', models: [...] },
// ]

// Flat list across all providers
const allModels = await sdk.listModels();

// Filter by capability
const toolModels = allModels.filter(m => m.capabilities.toolCalling);
const visionModels = allModels.filter(m => m.capabilities.vision);
const reasoningModels = allModels.filter(m => m.reasoningTier);
```

## Modes

Modes control AI behavior by setting a system prompt, filtering available tools, and configuring the workflow engine. The SDK ships with three built-in modes and supports unlimited custom modes.

### Built-in Modes

| Mode | Tools | Workflow | Description |
|------|-------|----------|-------------|
| **Agent** | All tools | Planning + step execution + dynamic steps | Full autonomous access — read, write, execute, browse |
| **Coding** | All tools | Concise planning + step execution | Optimized for coding tasks — minimal text, file operations |
| **Chat** | Web/HTTP only | Direct execution (no planning) | Conversational assistant with web access |

### Custom Modes

```typescript
import { createMode, Toolpack } from 'toolpack-sdk';

// Read-only code reviewer
const reviewMode = createMode({
  name: 'review',
  displayName: 'Code Review',
  systemPrompt: 'You are a senior code reviewer. Read files but NEVER modify them.',
  allowedToolCategories: ['filesystem', 'coding', 'version-control'],
  blockedTools: ['fs.write_file', 'fs.delete_file', 'fs.append_file'],
  baseContext: {
    includeWorkingDirectory: true,
    includeToolCategories: true,
  },
  workflow: {
    planning: { enabled: true },
    steps: { enabled: true, retryOnFailure: true },
    progress: { enabled: true },
  },
});

// Pure conversation — no tools at all
const simpleChat = createMode({
  name: 'simple-chat',
  displayName: 'Simple Chat',
  systemPrompt: 'You are a helpful assistant. Provide clear and concise responses.',
  blockAllTools: true, // Disables all tool calls
});

const sdk = await Toolpack.init({
  providers: { openai: {} },
  tools: true,
  customModes: [reviewMode, simpleChat],
  defaultMode: 'agent',
});

// Switch modes at runtime
sdk.setMode('review');
sdk.setMode('simple-chat');
sdk.cycleMode(); // Cycles through all registered modes
```

### Mode Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | **required** | Unique identifier |
| `displayName` | string | **required** | Human-readable label for UI |
| `systemPrompt` | string | **required** | System prompt injected into every request |
| `description` | string | `displayName` | Short tooltip description |
| `allowedToolCategories` | string[] | `[]` (all) | Tool categories to allow. Empty = all allowed |
| `blockedToolCategories` | string[] | `[]` | Tool categories to block. Overrides allowed |
| `allowedTools` | string[] | `[]` (all) | Specific tools to allow. Empty = all allowed |
| `blockedTools` | string[] | `[]` | Specific tools to block. Overrides allowed |
| `blockAllTools` | boolean | `false` | If `true`, disables all tools (pure conversation) |
| `baseContext` | object/false | `undefined` | Controls working directory and tool category injection |
| `workflow` | WorkflowConfig | `undefined` | Planning, step execution, and progress configuration |

## Workflow Engine

The workflow engine enables AI agents to plan and execute complex tasks step-by-step, with progress tracking, retries, and dynamic step additions.

### How It Works

1. **Planning** — The AI generates a structured step-by-step plan from the user's request
2. **Execution** — Each step is executed sequentially with tool access
3. **Dynamic Steps** — New steps can be added during execution based on results
4. **Retries** — Failed steps are retried automatically (configurable)
5. **Progress** — Events are emitted at each stage for UI integration

### Using the Workflow

```typescript
const sdk = await Toolpack.init({
  providers: { openai: {} },
  tools: true,
  defaultMode: 'agent', // Agent mode has workflow enabled
});

// Complex tasks are automatically planned and executed step-by-step
const result = await sdk.generate('Build me a REST API with user authentication');

// Or stream the response
for await (const chunk of sdk.stream({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Refactor this codebase' }],
})) {
  process.stdout.write(chunk.delta);
}
```

### Workflow Events

Workflow status is communicated via events (not in stream content), making it easy to build progress UIs:

```typescript
const executor = sdk.getWorkflowExecutor();

// Progress updates (ideal for status bars / shimmer text)
executor.on('workflow:progress', (progress) => {
  // progress.status: 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed'
  // progress.currentStep, progress.totalSteps, progress.percentage
  // progress.currentStepDescription — includes retry info if retrying
  console.log(`[${progress.percentage}%] Step ${progress.currentStep}/${progress.totalSteps}: ${progress.currentStepDescription}`);
});

// Step lifecycle
executor.on('workflow:step_start', (step, plan) => {
  console.log(`Starting: ${step.description}`);
});

executor.on('workflow:step_complete', (step, plan) => {
  console.log(`Completed: ${step.description}`);
});

executor.on('workflow:step_failed', (step, error, plan) => {
  console.log(`Failed: ${step.description} — ${error.message}`);
});

executor.on('workflow:step_retry', (step, attempt, plan) => {
  console.log(`Retrying: ${step.description} (attempt ${attempt})`);
});

executor.on('workflow:step_added', (step, plan) => {
  console.log(`Dynamic step added: ${step.description}`);
});

// Workflow completion
executor.on('workflow:completed', (plan, result) => {
  console.log(`Done! ${result.metrics.stepsCompleted} steps in ${result.metrics.totalDuration}ms`);
});

executor.on('workflow:failed', (plan, error) => {
  console.log(`Workflow failed: ${error.message}`);
});
```

### WorkflowConfig

```typescript
interface WorkflowConfig {
  planning?: {
    enabled: boolean;           // Enable planning phase
    requireApproval?: boolean;  // Pause for user approval before executing
    planningPrompt?: string;    // Custom system prompt for plan generation
    maxSteps?: number;          // Max steps in a plan (default: 20)
  };

  steps?: {
    enabled: boolean;           // Enable step-by-step execution
    retryOnFailure?: boolean;   // Retry failed steps (default: true)
    maxRetries?: number;        // Max retries per step (default: 3)
    allowDynamicSteps?: boolean; // Allow adding steps during execution
    maxTotalSteps?: number;     // Max total steps including dynamic (default: 50)
  };

  progress?: {
    enabled: boolean;           // Emit progress events (default: true)
    reportPercentage?: boolean; // Include completion percentage
  };

  onFailure?: {
    strategy: 'abort' | 'skip' | 'ask_user';
  };
}
```

### Custom Workflow Presets

The SDK provides built-in workflow presets for common use cases:

```typescript
import { DEFAULT_WORKFLOW, AGENT_WORKFLOW, CODING_WORKFLOW, CHAT_WORKFLOW } from 'toolpack-sdk';
```

| Preset | Planning | Steps | Description |
|--------|----------|-------|-------------|
| `DEFAULT_WORKFLOW` | Disabled | Disabled | Direct execution, no planning |
| `AGENT_WORKFLOW` | Enabled (detailed) | Enabled | Full autonomous agent with 11 planning rules |
| `CODING_WORKFLOW` | Enabled (concise) | Enabled | Minimal prompts optimized for coding tasks |
| `CHAT_WORKFLOW` | Disabled | Disabled | Simple conversational mode |

### Creating Custom Workflows

Define custom workflows by extending presets or creating from scratch:

```typescript
import { WorkflowConfig, AGENT_WORKFLOW } from 'toolpack-sdk';

// Extend an existing preset
const DOC_WORKFLOW: WorkflowConfig = {
  ...AGENT_WORKFLOW,
  name: 'Documentation',
  planning: {
    enabled: true,
    planningPrompt: `Create a documentation plan.

Rules:
1. Read existing code files first
2. Identify public APIs needing documentation
3. Generate docs in consistent format
4. Output JSON: {"summary": "...", "steps": [...]}`,
  },
  steps: {
    ...AGENT_WORKFLOW.steps,
    stepPrompt: `Execute step {stepNumber}: {stepDescription}

Analyze code and write clear documentation.
Focus on: purpose, parameters, return values, examples.

Previous: {previousStepsResults}`,
  },
};

// Use in a custom mode
import { createMode } from 'toolpack-sdk';

const docMode = createMode({
  name: 'docs',
  displayName: 'Documentation',
  systemPrompt: 'Documentation assistant. Generate clear API docs.',
  workflow: DOC_WORKFLOW,
  allowedToolCategories: ['filesystem', 'coding'],
});
```

### Step Prompt Template Variables

When using custom `stepPrompt`, these variables are automatically substituted:

| Variable | Description |
|----------|-------------|
| `{stepNumber}` | Current step number (1-indexed) |
| `{planSummary}` | Summary of the overall plan |
| `{stepDescription}` | Description of the current step |
| `{previousStepsResults}` | Output from completed steps (truncated to 2000 chars) |

### Workflow Prompt Tips

- **Keep planning prompts concise** — LLMs perform better with 5-7 clear rules
- **Use JSON schema examples** — Include the exact expected output format
- **Avoid meta-commentary in step prompts** — The AI should just execute, not discuss
- **Leverage previous results** — The `{previousStepsResults}` variable provides context

## Tool Call Events

The SDK emits events for tool execution, useful for building tool activity logs:

```typescript
const client = sdk.getClient();

// Detailed log of every tool execution
client.on('tool:log', (event) => {
  console.log(`Tool: ${event.name} (${event.status}) — ${event.duration}ms`);
  console.log(`  Args: ${JSON.stringify(event.arguments)}`);
  console.log(`  Result: ${event.result.substring(0, 200)}...`);
});

// Progress events (started, completed, failed)
client.on('tool:started', (event) => { /* ... */ });
client.on('tool:completed', (event) => { /* ... */ });
client.on('tool:failed', (event) => { /* ... */ });
```

## Custom Tools

In addition to the 97 built-in tools, you can create and register your own custom tool projects using `createToolProject()`:

```typescript
import { Toolpack, createToolProject } from 'toolpack-sdk';

// Define a custom tool project
const myToolProject = createToolProject({
  key: 'my-tools',
  name: 'my-tools',
  displayName: 'My Custom Tools',
  version: '1.0.0',
  description: 'Custom tools for my application',
  category: 'custom',
  author: 'Your Name',
  tools: [
    {
      name: 'my.hello',
      displayName: 'Hello World',
      description: 'A simple hello world tool',
      category: 'custom',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
      },
      execute: async (args) => {
        return `Hello, ${args.name}!`;
      },
    },
  ],
});

// Register custom tools at init
const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,              // Load built-in tools
  customTools: [myToolProject], // Add your custom tools
});
```

### Tool Project Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | ✓ | Unique identifier (lowercase, hyphens only) |
| `name` | string | ✓ | Package name |
| `displayName` | string | ✓ | Human-readable name |
| `version` | string | ✓ | Semver version |
| `description` | string | ✓ | Short description |
| `category` | string | ✓ | Tool category for filtering |
| `author` | string | | Author name |
| `tools` | ToolDefinition[] | ✓ | Array of tool definitions |
| `dependencies` | Record<string, string> | | npm dependencies (validated at load) |

## Knowledge & RAG (Retrieval-Augmented Generation)

For AI applications that need to search and reference documentation, use the companion `@toolpack-sdk/knowledge` package:

```bash
npm install @toolpack-sdk/knowledge
```

### Quick Start

```typescript
import { Knowledge, MemoryProvider, MarkdownSource, OllamaEmbedder } from '@toolpack-sdk/knowledge';
import { Toolpack } from 'toolpack-sdk';

// Create a knowledge base from markdown files
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [new MarkdownSource('./docs/**/*.md')],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  description: 'Search this for setup and configuration questions.',
});

// Integrate with Toolpack SDK
const toolpack = await Toolpack.init({
  provider: 'openai',
  knowledge: kb,  // Registered as knowledge_search tool
});

// The AI can now search your documentation
const response = await toolpack.chat('How do I configure authentication?');
```

### Features

- **Multiple Providers**: In-memory (`MemoryProvider`) or persistent SQLite (`PersistentKnowledgeProvider`)
- **Multiple Embedders**: OpenAI, Ollama (local), or custom embedders
- **Multiple Sources**: Markdown, JSON, SQLite ingestion
- **Progress Events**: Track embedding progress with `onEmbeddingProgress`
- **Metadata Filtering**: Query with filters like `{ hasCode: true, category: 'api' }`

See the [Knowledge package README](./packages/toolpack-knowledge/README.md) for full documentation.

## AI Agents (@toolpack-sdk/agents)

Build production-ready AI agents with channels, workflows, and event-driven architecture using the companion `@toolpack-sdk/agents` package:

```bash
npm install @toolpack-sdk/agents
```

### What are Agents?

Agents are autonomous AI systems that:
- **Listen** for events from channels (Slack, webhooks, schedules, etc.)
- **Process** messages using the Toolpack SDK
- **Execute** tasks with full tool access
- **Respond** back through the same or different channels
- **Remember** conversations using knowledge bases

### Quick Start

```typescript
import { Toolpack } from 'toolpack-sdk';
import { BaseAgent, AgentRegistry, SlackChannel } from '@toolpack-sdk/agents';

// 1. Create a custom agent
class SupportAgent extends BaseAgent {
  name = 'support-agent';
  description = 'Customer support agent that answers questions';
  mode = 'chat';

  async invokeAgent(input) {
    const result = await this.run(input.message);
    await this.sendTo('slack-support', result.output);
    return result;
  }
}

// 2. Set up channels
const slackChannel = new SlackChannel({
  name: 'slack-support',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// 3. Register agent and channels
const registry = new AgentRegistry([
  { agent: SupportAgent, channels: [slackChannel] },
]);

// 4. Initialize Toolpack with agents
const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
  agents: registry,
});

// Agents now listen and respond automatically!
```

### Built-in Agents

The package includes 4 production-ready agents you can use directly or extend:

#### ResearchAgent
```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

const agent = new ResearchAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Summarize recent developments in edge AI',
});
```
- **Mode:** `agent`
- **Tools:** web.search, web.fetch, web.scrape
- **Use Cases:** Market research, competitive analysis, trend monitoring

#### CodingAgent
```typescript
import { CodingAgent } from '@toolpack-sdk/agents';

const agent = new CodingAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Refactor the auth module to use the new SDK pattern',
});
```
- **Mode:** `coding`
- **Tools:** fs.*, coding.*, git.*, exec.*
- **Use Cases:** Code generation, refactoring, debugging, test writing

#### DataAgent
```typescript
import { DataAgent } from '@toolpack-sdk/agents';

const agent = new DataAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Generate a weekly summary of signups by region',
});
```
- **Mode:** `agent`
- **Tools:** db.*, fs.*, http.*
- **Use Cases:** Database queries, reporting, data analysis, CSV generation

#### BrowserAgent
```typescript
import { BrowserAgent } from '@toolpack-sdk/agents';

const agent = new BrowserAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Extract all product prices from acme.com/products',
});
```
- **Mode:** `chat`
- **Tools:** web.fetch, web.screenshot, web.extract_links
- **Use Cases:** Web scraping, form filling, content extraction

### Channels

Channels connect agents to the outside world. The package includes 7 built-in channels:

#### SlackChannel (Two-way)
```typescript
import { SlackChannel } from '@toolpack-sdk/agents';

const slack = new SlackChannel({
  name: 'slack-support',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
```
- ✅ Receives messages from Slack
- ✅ Replies in threads
- ✅ Supports `ask()` for human input

#### TelegramChannel (Two-way)
```typescript
import { TelegramChannel } from '@toolpack-sdk/agents';

const telegram = new TelegramChannel({
  name: 'telegram-bot',
  token: process.env.TELEGRAM_BOT_TOKEN,
});
```
- ✅ Receives messages from Telegram
- ✅ Replies to users
- ✅ Supports `ask()` for human input

#### WebhookChannel (Two-way)
```typescript
import { WebhookChannel } from '@toolpack-sdk/agents';

const webhook = new WebhookChannel({
  name: 'github-webhook',
  path: '/webhook/github',
  port: 3000,
  secret: process.env.WEBHOOK_SECRET,
});
```
- ✅ Receives HTTP POST webhooks
- ✅ Signature verification
- ✅ Supports `ask()` for human input

#### ScheduledChannel (Trigger-only)
```typescript
import { ScheduledChannel } from '@toolpack-sdk/agents';

const scheduler = new ScheduledChannel({
  name: 'daily-report',
  cron: '0 9 * * 1-5', // 9am weekdays
  notify: 'webhook:https://hooks.example.com/daily-report',
  message: 'Generate the daily sales report',
});
// For Slack delivery, attach a named SlackChannel to the same agent and
// call `this.sendTo('<slackChannelName>', output)` from within `run()`.
```
- ⏰ Triggers agents on cron schedules
- ✅ Full cron expression support (ranges, steps, lists, combinations)
- ❌ No `ask()` support (no human recipient)

#### DiscordChannel (Two-way)
```typescript
import { DiscordChannel } from '@toolpack-sdk/agents';

const discord = new DiscordChannel({
  name: 'discord-bot',
  token: process.env.DISCORD_BOT_TOKEN,
  guildId: 'your-guild-id',
  channelId: 'your-channel-id',
});
```
- ✅ Receives messages from Discord
- ✅ Replies in threads
- ✅ Supports `ask()` for human input

#### EmailChannel (Outbound-only)
```typescript
import { EmailChannel } from '@toolpack-sdk/agents';

const email = new EmailChannel({
  name: 'email-alerts',
  from: 'bot@acme.com',
  to: 'team@acme.com',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    auth: { user: 'bot@acme.com', pass: process.env.SMTP_PASSWORD },
  },
});
```
- 📧 Sends emails via SMTP
- ❌ No `ask()` support (outbound-only)

#### SMSChannel (Configurable)
```typescript
import { SMSChannel } from '@toolpack-sdk/agents';

// Two-way with webhook
const sms = new SMSChannel({
  name: 'sms-alerts',
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: '+1234567890',
  webhookPath: '/sms/webhook', // Enables two-way
  port: 3000,
});

// Outbound-only
const smsOutbound = new SMSChannel({
  name: 'sms-notifications',
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: '+1234567890',
  to: '+0987654321', // Fixed recipient
});
```
- 📱 Twilio SMS integration
- ✅ Two-way when `webhookPath` is set
- ❌ Outbound-only without webhook

### Agent Lifecycle & Events

Agents emit events at each stage of execution:

```typescript
const agent = new MyAgent(sdk);

agent.on('agent:start', (input) => {
  console.log('Agent started:', input.message);
});

agent.on('agent:complete', (result) => {
  console.log('Agent completed:', result.output);
});

agent.on('agent:error', (error) => {
  console.error('Agent error:', error);
});
```

### Knowledge Integration

Agents can use knowledge bases for conversation memory and RAG:

```typescript
import { Knowledge, MemoryProvider, OllamaEmbedder } from '@toolpack-sdk/knowledge';
import { BaseAgent } from '@toolpack-sdk/agents';

class SmartAgent extends BaseAgent {
  name = 'smart-agent';
  description = 'Agent with memory';
  mode = 'chat';
  
  constructor(toolpack) {
    super(toolpack);
    // Set up knowledge base
    this.knowledge = await Knowledge.create({
      provider: new MemoryProvider(),
      embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
    });
  }

  async invokeAgent(input) {
    // Conversation history is automatically loaded from knowledge
    const result = await this.run(input.message);
    return result;
  }
}
```

### Multi-Channel Routing

Agents can send output to different channels:

```typescript
class MultiChannelAgent extends BaseAgent {
  name = 'multi-agent';
  description = 'Routes to multiple channels';
  mode = 'agent';

  async invokeAgent(input) {
    const result = await this.run(input.message);
    
    // Send to multiple channels
    await this.sendTo('slack:#general', result.output);
    await this.sendTo('email-team', result.output);
    await this.sendTo('sms-alerts', 'Task completed!');
    
    return result;
  }
}
```

### Extending Built-in Agents

```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

class FintechResearchAgent extends ResearchAgent {
  systemPrompt = `You are a research agent focused on fintech.
                  Always cite sources and flag regulatory implications.`;
  provider = 'anthropic';
  model = 'claude-sonnet-4-20250514';

  async onComplete(result) {
    // Store research in knowledge base
    if (this.knowledge) {
      await this.knowledge.add(result.output, { 
        category: 'research',
        topic: 'fintech',
      });
    }
    
    // Send to Slack
    await this.sendTo('slack-research', result.output);
  }
}
```

### Features

- ✅ **7 Built-in Channels** — Slack, Telegram, Discord, Email, SMS, Webhook, Scheduled
- ✅ **4 Built-in Agents** — Research, Coding, Data, Browser
- ✅ **Event-Driven** — Full lifecycle events for monitoring
- ✅ **Knowledge Integration** — Conversation memory and RAG
- ✅ **Multi-Channel Routing** — Send to any registered channel
- ✅ **Human-in-the-Loop** — `ask()` support for two-way channels
- ✅ **Type-Safe** — Full TypeScript support
- ✅ **199 Tests Passing** — Production-ready

See the [Agents package README](./packages/toolpack-agents/README.md) for full documentation.

## Multimodal Support

The SDK supports multimodal inputs (text + images) across all vision-capable providers. Images can be provided in three formats:

```typescript
import { Toolpack, ImageFilePart, ImageDataPart, ImageUrlPart } from 'toolpack-sdk';

const sdk = await Toolpack.init({ provider: 'openai' });

// 1. Local file path (auto-converted to base64)
const filePart: ImageFilePart = {
  type: 'image_file',
  image_file: { path: '/path/to/image.png', detail: 'high' }
};

// 2. Base64 data (inline)
const dataPart: ImageDataPart = {
  type: 'image_data',
  image_data: { data: 'base64...', mimeType: 'image/png', detail: 'auto' }
};

// 3. HTTP URL (passed through or downloaded depending on provider)
const urlPart: ImageUrlPart = {
  type: 'image_url',
  image_url: { url: 'https://example.com/image.png', detail: 'low' }
};

// Use in messages
const response = await sdk.generate({
  model: 'gpt-4.1',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      filePart
    ]
  }]
});
```

### Provider Behavior

| Provider | File Path | Base64 | URL |
|----------|-----------|--------|-----|
| OpenAI | Converted to base64 | ✓ Native | ✓ Native |
| Anthropic | Converted to base64 | ✓ Native | Downloaded → base64 |
| Gemini | Converted to base64 | ✓ Native | Downloaded → base64 |
| Ollama | Converted to base64 | ✓ Native | Downloaded → base64 |

## Configuration

### Environment Variables

```bash
# Provider API keys (at least one required)
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_GENERATIVE_AI_KEY="AIza..."
export OPENROUTER_API_KEY="sk-or-..."

# SDK logging (override — prefer toolpack.config.json instead)
export TOOLPACK_SDK_LOG_FILE="./toolpack.log"    # Log file path (also enables logging)
export TOOLPACK_SDK_LOG_LEVEL="debug"            # Log level override (error, warn, info, debug, trace)
```

## Configuration Architecture

Toolpack uses a hierarchical configuration system that separates build-time (SDK) and runtime (CLI) configurations.

### Configuration Layers

1. **Workspace Local (Highest Priority)**
   - Location: `<workspace>/.toolpack/config/toolpack.config.json`
   - Purpose: Project-specific overrides for the CLI tool.

2. **Global Default (CLI First Run)**
   - Location: `~/.toolpack/config/toolpack.config.json`
   - Purpose: Global default settings for the CLI tool across all projects. Created automatically on first run.

3. **Build Time / SDK Base**
   - Location: `toolpack.config.json` in project root.
   - Purpose: Static configuration used when bundling the SDK or running it directly in an app.

### Settings UI

The CLI includes a settings screen to view the active configuration source and its location. Press `Ctrl+S` from the Home screen to access it.

### Configuration Sections

The `toolpack.config.json` file supports several sections:

#### Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `systemPrompt` | - | Override the base system prompt |
| `baseContext` | `true` | Agent context configuration (`{ includeWorkingDirectory, includeToolCategories, custom }` or `false`) |
| `modeOverrides` | `{}` | Mode-specific system prompt and toolSearch overrides |

#### Logging Configuration

Create a `toolpack.config.json` in your project root:

```json
{
  "logging": {
    "enabled": true,
    "filePath": "./toolpack.log",
    "level": "info"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable file logging |
| `filePath` | `toolpack-sdk.log` | Log file path (relative to CWD) |
| `level` | `info` | Log level (`error`, `warn`, `info`, `debug`, `trace`) |

### Tools Configuration

Create a `toolpack.config.json` in your project root:

```json
{
  "tools": {
    "enabled": true,
    "autoExecute": true,
    "maxToolRounds": 5,
    "toolChoicePolicy": "auto",
    "resultMaxChars": 20000,
    "enabledTools": [],
    "enabledToolCategories": [],
    "additionalConfigurations": {
      "webSearch": {
        "tavilyApiKey": "tvly-...",
        "braveApiKey": "BSA..."
      }
    },
    "toolSearch": {
      "enabled": false,
      "alwaysLoadedTools": ["fs.read_file", "fs.write_file", "fs.list_dir"],
      "alwaysLoadedCategories": [],
      "searchResultLimit": 5,
      "cacheDiscoveredTools": true
    }
  }
}
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable tool system |
| `autoExecute` | boolean | `true` | Auto-execute tool calls from AI |
| `maxToolRounds` | number | `5` | Max tool execution rounds per request |
| `toolChoicePolicy` | string | `"auto"` | `"auto"`, `"required"`, or `"required_for_actions"` |
| `enabledTools` | string[] | `[]` | Whitelist specific tools (empty = all) |
| `enabledToolCategories` | string[] | `[]` | Whitelist categories (empty = all) |

### HITL (Human-in-the-Loop) Configuration

Configure user confirmation for high-risk tool operations:

```json
{
  "hitl": {
    "enabled": true,
    "confirmationMode": "all",
    "bypass": {
      "tools": ["fs.write_file"],
      "categories": ["filesystem"],
      "levels": ["medium"]
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch for HITL confirmation |
| `confirmationMode` | string | `"all"` | `"off"`, `"high-only"`, or `"all"` |
| `bypass.tools` | string[] | `[]` | Tool names to bypass (e.g., `["fs.write_file"]`) |
| `bypass.categories` | string[] | `[]` | Categories to bypass (e.g., `["filesystem"]`) |
| `bypass.levels` | string[] | `[]` | Risk levels to bypass (`["high"]` or `["medium"]`) |

**Programmatic API:**

```typescript
import { addBypassRule, removeBypassRule } from 'toolpack-sdk';

// Add bypass rule
await addBypassRule({ type: 'tool', value: 'fs.delete_file' });

// Remove bypass rule
await removeBypassRule({ type: 'tool', value: 'fs.delete_file' });

// Reload config to apply changes
toolpack.reloadConfig();
```

See the [HITL documentation](https://toolpacksdk.com/guides/hitl-confirmation) for detailed configuration options and best practices.

#### Web Search Providers

The `web.search` tool supports multiple search backends with automatic fallback:

1. **Tavily** (recommended) — set `tavilyApiKey` in config. Free tier: 1000 searches/month.
2. **Brave Search** — set `braveApiKey` in config. Free tier: 2000 queries/month.
3. **DuckDuckGo Lite** — built-in fallback, no API key needed (may be rate-limited).

#### Tool Search (for large tool sets)

When you have many tools (50+), enable tool search to reduce token usage. The AI discovers tools on-demand via a built-in `tool.search` meta-tool using BM25 ranking:

```json
{
  "tools": {
    "toolSearch": {
      "enabled": true,
      "alwaysLoadedTools": ["fs.read_file", "fs.write_file", "web.search"],
      "searchResultLimit": 5,
      "cacheDiscoveredTools": true
    }
  }
}
```

## API Reference

### Toolpack (High-Level)

```typescript
import { Toolpack } from 'toolpack-sdk';

const sdk = await Toolpack.init(config: ToolpackInitConfig): Promise<Toolpack>

// Completions (routes through workflow engine if mode has workflow enabled)
await sdk.generate(request: CompletionRequest | string, provider?: string): Promise<CompletionResponse>
sdk.stream(request: CompletionRequest, provider?: string): AsyncGenerator<CompletionChunk>
await sdk.embed(request: EmbeddingRequest, provider?: string): Promise<EmbeddingResponse>

// Provider management
sdk.setProvider(name: string): void
await sdk.listProviders(): Promise<ProviderInfo[]>
await sdk.listModels(): Promise<(ProviderModelInfo & { provider: string })[]>

// Mode management
sdk.setMode(name: string): ModeConfig
sdk.getMode(): ModeConfig | null
sdk.getModes(): ModeConfig[]
sdk.cycleMode(): ModeConfig
sdk.registerMode(mode: ModeConfig): void

// Internal access
sdk.getClient(): AIClient
sdk.getWorkflowExecutor(): WorkflowExecutor
await sdk.disconnect(): Promise<void>
```

### AIClient (Low-Level)

```typescript
import { AIClient } from 'toolpack-sdk';

// Direct client usage (without workflow engine)
await client.generate(request: CompletionRequest, provider?: string): Promise<CompletionResponse>
client.stream(request: CompletionRequest, provider?: string): AsyncGenerator<CompletionChunk>
await client.embed(request: EmbeddingRequest, provider?: string): Promise<EmbeddingResponse>
```

### Core Types

```typescript
interface CompletionRequest {
  messages: Message[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  tools?: ToolCallRequest[];
  requestTools?: RequestToolDefinition[];  // Request-scoped tools
  tool_choice?: 'auto' | 'none' | 'required';
}

interface CompletionResponse {
  content: string | null;
  usage?: Usage;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  tool_calls?: ToolCallResult[];
}

interface CompletionChunk {
  delta: string;
  usage?: Usage;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  tool_calls?: ToolCallResult[];
}

interface ProviderModelInfo {
  id: string;
  displayName: string;
  capabilities: { chat, streaming, toolCalling, embeddings, vision, reasoning? };
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];   // e.g., ['text', 'image']
  outputModalities?: string[];  // e.g., ['text']
  reasoningTier?: string | null; // e.g., 'standard', 'extended'
  costTier?: string;            // e.g., 'low', 'medium', 'high', 'premium'
}
```

### Request-Scoped Tools

Request-scoped tools are dynamic tools attached to a single completion request. Unlike globally registered tools in the ToolRegistry, they:

- **Don't pollute the shared registry** — Each request can have its own tools
- **Can close over request-specific state** — e.g., `conversationId`, user context
- **Are safe for multi-agent/multi-request usage** — No cross-request contamination
- **Execute through the same SDK orchestration** — Events, logging, HITL all work

#### Built-in Request-Scoped Tools

**Knowledge Tools** (when `knowledge` is configured):
- `knowledge_search` — Search the knowledge base for relevant information
- `knowledge_add` — Add new content to the knowledge base at runtime

**Conversation Tools** (when using `ConversationHistory`):
- `conversation_search` — Search conversation history for past messages

#### Creating Custom Request Tools

```typescript
import { RequestToolDefinition, ConversationHistory } from 'toolpack-sdk';

// Example: Session-specific calculator
const createCalculatorTool = (sessionId: string): RequestToolDefinition => ({
  name: 'calculate',
  displayName: 'Calculator',
  description: 'Perform mathematical calculations',
  category: 'math',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression to evaluate' },
    },
    required: ['expression'],
  },
  execute: async (args) => {
    // Can safely close over sessionId
    console.log(`Session ${sessionId}: calculating ${args.expression}`);
    
    // Simple eval (use a proper math library in production)
    const result = eval(args.expression);
    return { result, sessionId };
  },
});

// Use in a request
const result = await sdk.generate({
  messages: [{ role: 'user', content: 'What is 15 * 23?' }],
  model: 'gpt-4',
  requestTools: [createCalculatorTool('user-123')],
});
```

#### Using ConversationHistory with Request Tools

```typescript
import { ConversationHistory } from 'toolpack-sdk';

const history = new ConversationHistory('./chat.db');

// Add some messages
await history.addUserMessage('conv-1', 'What is the API rate limit?');
await history.addAssistantMessage('conv-1', 'The rate limit is 100 requests per minute.');

// Use conversation search in a request
const result = await sdk.generate({
  messages: [
    { role: 'user', content: 'What did we discuss about rate limits?' }
  ],
  model: 'gpt-4',
  requestTools: [
    history.toTool('conv-1'),  // Scoped to conversation 'conv-1'
  ],
});

// AI can now call conversation_search to find the earlier discussion
```

#### Request Tools vs Registry Tools

| Feature | Request Tools | Registry Tools |
|---------|---------------|----------------|
| **Scope** | Single request | All requests |
| **State** | Can close over request state | Stateless |
| **Registration** | Per-request via `requestTools` | Global via `ToolRegistry` |
| **Use Case** | Dynamic, stateful tools | Reusable, static tools |
| **Priority** | Higher (checked first) | Lower |
| **Examples** | `conversation_search`, `knowledge_add` | `fs.read_file`, `web.search` |

#### Automatic Guidance Injection

When request-scoped tools are present, the SDK automatically injects usage guidance into the system prompt:

```
Knowledge Base:
- Use `knowledge_search` when you need factual or domain-specific information.
- Use `knowledge_add` when you learn durable information that should be saved.

Conversation History:
- Only recent messages may be present in context.
- Use `conversation_search` to find details from earlier in this conversation.
```

This guidance is:
- **Per-request** — Only injected when tools are actually present
- **Derived from effective tool set** — Reflects the actual tools available
- **Idempotent** — Won't duplicate if already present

## Error Handling

The SDK provides typed error classes for common failure scenarios:

```typescript
import { AuthenticationError, RateLimitError, InvalidRequestError, ProviderError, ConnectionError, TimeoutError } from 'toolpack-sdk';

try {
  await sdk.generate('Hello');
} catch (err) {
  if (err instanceof AuthenticationError) { /* Invalid API key (401) */ }
  if (err instanceof RateLimitError) { /* Rate limited (429), check err.retryAfter */ }
  if (err instanceof InvalidRequestError) { /* Bad request (400) */ }
  if (err instanceof ConnectionError) { /* Provider unreachable (503) */ }
  if (err instanceof TimeoutError) { /* Request timed out (504) */ }
  if (err instanceof ProviderError) { /* Generic provider error (500) */ }
}
```

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

### Watch Mode

```bash
npm run watch
```

## Architecture

```
toolpack-sdk/
├── src/
│   ├── toolpack.ts       # Toolpack class — high-level facade
│   ├── client/            # AIClient — provider routing, tool execution, mode injection
│   ├── providers/         # Provider adapter implementations
│   │   ├── base/          # ProviderAdapter abstract class
│   │   ├── openai/        # OpenAI adapter
│   │   ├── anthropic/     # Anthropic adapter
│   │   ├── gemini/        # Google Gemini adapter
│   │   ├── openrouter/    # OpenRouter adapter (OpenAI-compatible, dynamic model discovery)
│   │   └── ollama/        # Ollama adapter + provider (auto-discovery)
│   ├── modes/             # Mode system (Agent, Chat, createMode)
│   ├── workflows/         # Workflow engine (planner, step executor, progress)
│   ├── tools/             # 97 built-in tools + registry + router + BM25 search
│   │   ├── fs-tools/      # File system (18 tools)
│   │   ├── coding-tools/  # Code analysis (12 tools)
│   │   ├── git-tools/     # Git operations (9 tools)
│   │   ├── db-tools/      # Database operations (6 tools)
│   │   ├── exec-tools/    # Command execution (6 tools)
│   │   ├── http-tools/    # HTTP requests (5 tools)
│   │   ├── web-tools/     # Web interaction (5 tools)
│   │   ├── system-tools/  # System info (5 tools)
│   │   ├── diff-tools/    # Patch operations (3 tools)
│   │   ├── cloud-tools/   # Deployments (3 tools)
│   │   ├── k8s-tools/     # Kubernetes management (11 tools)
│   │   ├── registry.ts    # Tool registry and loading
│   │   ├── router.ts      # Tool routing and filtering
│   │   └── search/        # BM25 tool discovery engine (internal)
│   ├── types/             # Core TypeScript interfaces
│   ├── errors/            # Typed error hierarchy
│   ├── mcp/               # MCP (Model Context Protocol) utilities
│   └── utils/             # Shared utilities
└── tests/                 # 545 tests across 81 test files
```

## Status

**Current Version:** 0.1.0

- ✓ **5 Built-in Providers** — OpenAI, Anthropic, Gemini, Ollama, OpenRouter (+ custom provider API)
- ✓ **90 Built-in Tools** — fs, exec, git, diff, web, coding, db, cloud, http, system, Kubernetes
- ✓ **Workflow Engine** — AI-driven planning, step execution, retries, dynamic steps, progress events
- ✓ **Mode System** — Agent, Coding, Chat, and custom modes via `createMode()` with `blockAllTools` support
- ✓ **Tool Search** — BM25-based on-demand tool discovery for large tool libraries
- ✓ **545 Tests** passing across 81 test files

## Contributing

Contributions welcome! Please read the [contributing guide](./CONTRIBUTING.md) first.

## License

Apache 2.0 © [Sajeer](https://sajeerzeji.com)

## Support

- 🐛 [Issue Tracker](https://github.com/toolpack-ai/toolpack-sdk/issues) (Please use our [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) or [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) templates)
- 💬 [Discussions](https://github.com/toolpack-ai/toolpack-sdk/discussions)

---

**Author:** [Sajeer](https://sajeerzeji.com)
