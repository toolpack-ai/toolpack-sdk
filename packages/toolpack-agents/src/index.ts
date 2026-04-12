// Agent layer for Toolpack SDK
// Build, compose, and deploy AI agents with a consistent, extensible pattern

// Core agent types and classes
export {
  AgentInput,
  AgentResult,
  AgentOutput,
  AgentRunOptions,
  AgentRegistration,
  WorkflowStep,
  IAgentRegistry,
  AgentInstance,
  ChannelInterface,
  PendingAsk,
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
