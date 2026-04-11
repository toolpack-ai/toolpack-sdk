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

// Channel base class and implementations
export { BaseChannel } from './channels/base-channel.js';
export { SlackChannel, SlackChannelConfig } from './channels/slack.js';
export { WebhookChannel, WebhookChannelConfig } from './channels/webhook.js';
export { ScheduledChannel, ScheduledChannelConfig } from './channels/scheduled.js';
export { TelegramChannel, TelegramChannelConfig } from './channels/telegram.js';
