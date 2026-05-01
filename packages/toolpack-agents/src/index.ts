// Agent layer for Toolpack SDK
// Build, compose, and deploy AI agents with a consistent, extensible pattern

// Core agent types and classes
export {
  AgentInput,
  AgentResult,
  AgentOutput,
  AgentRunOptions,
  BaseAgentOptions,
  WorkflowStep,
  IAgentRegistry,
  AgentInstance,
  ChannelInterface,
  PendingAsk,
  Participant,
} from './agent/types.js';

export { BaseAgent, AgentEvents } from './agent/base-agent.js';
export { AgentRegistry } from './agent/agent-registry.js';
export { AgentError } from './agent/errors.js';

// Built-in agents
export { ResearchAgent } from './agents/research-agent.js';
export { CodingAgent } from './agents/coding-agent.js';
export { DataAgent } from './agents/data-agent.js';
export { BrowserAgent } from './agents/browser-agent.js';

// Channel base class and implementations
export { BaseChannel } from './channels/base-channel.js';
export { SlackChannel, SlackChannelConfig } from './channels/slack-channel.js';
export { WebhookChannel, WebhookChannelConfig } from './channels/webhook-channel.js';
export { ScheduledChannel, ScheduledChannelConfig } from './channels/scheduled-channel.js';
export { TelegramChannel, TelegramChannelConfig } from './channels/telegram-channel.js';
export { DiscordChannel, DiscordChannelConfig } from './channels/discord-channel.js';
export { EmailChannel, EmailChannelConfig } from './channels/email-channel.js';
export { SMSChannel, SMSChannelConfig } from './channels/sms-channel.js';

// Transport layer for agent-to-agent communication
export {
  AgentTransport,
  AgentRegistryTransportOptions,
  LocalTransport,
  JsonRpcTransport,
  AgentJsonRpcServer,
} from './transport/index.js';

// Capability agents for cross-cutting concerns (interceptors, summarization)
export {
  IntentClassifierAgent,
  IntentClassifierInput,
  IntentClassification,
  SummarizerAgent,
  SummarizerInput,
  SummarizerOutput,
  HistoryTurn,
} from './capabilities/index.js';
// Participant is now a core type in agent/types.ts (exported above).

// Conversation history — storage, assembly, and retrieval
export {
  type ConversationScope,
  type StoredMessage,
  type GetOptions,
  type SearchOptions,
  type AssemblerOptions,
  type PromptMessage,
  type AssembledPrompt,
  type ConversationStore,
  InMemoryConversationStore,
  type InMemoryConversationStoreConfig,
  assemblePrompt,
  createConversationSearchTool,
  type ConversationSearchTool,
  type ConversationSearchToolConfig,
} from './history/index.js';

// Interceptor system for composable middleware
export {
  SKIP_SENTINEL,
  type InterceptorResult,
  type InterceptorContext,
  type NextFunction,
  type Interceptor,
  type InterceptorChainConfig,
  type ComposedChain,
  isSkipSentinel,
  skip,
  InvocationDepthExceededError,
  composeChain,
  executeChain,
  // Built-in interceptors
  createEventDedupInterceptor,
  type EventDedupConfig,
  createNoiseFilterInterceptor,
  type NoiseFilterConfig,
  createSelfFilterInterceptor,
  type SelfFilterConfig,
  createRateLimitInterceptor,
  type RateLimitConfig,
  createParticipantResolverInterceptor,
  type ParticipantResolverConfig,
  createCaptureInterceptor,
  type CaptureHistoryConfig,
  createAddressCheckInterceptor,
  type AddressCheckConfig,
  type AddressCheckResult,
  createIntentClassifierInterceptor,
  type IntentClassifierInterceptorConfig,
  createDepthGuardInterceptor,
  type DepthGuardConfig,
  DepthExceededError,
  createTracerInterceptor,
  type TracerConfig,
} from './interceptors/index.js';
