# Changelog

All notable changes to `@toolpack-sdk/agents` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - Phase 4 Release

### Added

#### Testing Utilities (`@toolpack-sdk/agents/testing`)
- `MockChannel` — Test channel for agent testing
- `createMockKnowledge()` / `createMockKnowledgeSync()` — Mock knowledge base for testing
- `createTestAgent()` — Helper to create test agents with mock dependencies
- `createMockToolpackSimple()` / `createMockToolpackSequence()` — Mock LLM response helpers
- `captureEvents()` / `registerEventMatchers()` — Event testing utilities

#### Community Registry (`@toolpack-sdk/agents/registry`)
- `searchRegistry()` — Search NPM registry for toolpack agents
- `RegistryAgent` type — Agent metadata from registry
- `ToolpackAgentMetadata` spec — Standard metadata for published agents

#### Agent-to-Agent Messaging
- `BaseAgent.delegate()` — Fire-and-forget delegation to another agent
- `BaseAgent.delegateAndWait()` — Synchronous delegation with result
- `AgentTransport` interface — Pluggable transport layer
- `LocalTransport` — Same-process agent communication
- `JsonRpcTransport` — Cross-process JSON-RPC communication
- `AgentJsonRpcServer` — Multi-agent JSON-RPC server for hosting agents

#### Built-in Agents
- `ResearchAgent` — Web research and information gathering
- `CodingAgent` — Code generation and refactoring
- `DataAgent` — Database queries and data analysis
- `BrowserAgent` — Web browsing and content extraction

#### Channels
- `DiscordChannel` — Discord bot integration
- `EmailChannel` — Email sending via SMTP
- `SMSChannel` — SMS sending via Twilio

### Changed

- All public APIs now have full JSDoc documentation
- `AgentRegistry` now accepts optional `transport` configuration
- `IAgentRegistry` interface extended with `getAgent()` and `getAllAgents()` methods

### Migration Notes

#### From Phase 1-3 to Phase 4

**No breaking changes** — all existing code continues to work.

**Recommended updates:**

1. **Agent delegation** — Consider using `delegate()` or `delegateAndWait()` instead of tight coupling:
   ```typescript
   // Before: Tight coupling
   const dataAgent = new DataAgent(toolpack);
   const result = await dataAgent.invokeAgent({ message: 'test' });
   
   // After: Loose coupling via delegation
   const result = await this.delegateAndWait('data-agent', { message: 'test' });
   ```

2. **Testing** — Use new testing utilities for better test isolation:
   ```typescript
   import { createTestAgent, MockChannel } from '@toolpack-sdk/agents/testing';
   ```

3. **Registry** — Search for community agents:
   ```typescript
   import { searchRegistry } from '@toolpack-sdk/agents/registry';
   const agents = await searchRegistry({ keyword: 'fintech' });
   ```

### Fixed

- Improved error messages for missing agent registrations
- Better handling of pending ask expiration

## [1.2.0] - Phase 3

### Added
- Built-in agents (ResearchAgent, CodingAgent, DataAgent, BrowserAgent)
- Knowledge integration with RAG support
- Human-in-the-loop `ask()` functionality
- ScheduledChannel for cron-based triggers

## [1.1.0] - Phase 2

### Added
- Knowledge base support
- `BaseAgent` lifecycle hooks
- Event system (`agent:start`, `agent:complete`, `agent:error`)

## [1.0.0] - Phase 1

### Added
- Initial release
- `BaseAgent` abstract class
- `AgentRegistry` for agent management
- `SlackChannel`, `WebhookChannel` for integrations
- `Toolpack.init()` integration
