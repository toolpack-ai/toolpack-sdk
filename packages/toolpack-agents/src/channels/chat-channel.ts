import { BaseChannel } from './base-channel.js';
import type { AgentInput, AgentOutput } from '../agent/types.js';
import type { ImagePart, FilePart } from 'toolpack-sdk';

export interface ChatChannelConfig {
  name?: string;
}

/**
 * Chat channel for in-app UI conversations.
 * The API endpoint returns the response synchronously, so send() is a no-op.
 * listen() is also a no-op — this channel is always driven by HTTP, not polled.
 */
export class ChatChannel extends BaseChannel {
  readonly isTriggerChannel = false;

  constructor(config: ChatChannelConfig = {}) {
    super();
    this.name = config.name;
  }

  listen(): void {}

  async send(_output: AgentOutput): Promise<void> {}

  normalize(incoming: unknown): AgentInput {
    const body = incoming as Record<string, unknown>;
    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as Array<ImagePart | FilePart>)
      : undefined;
    this.validateAttachments(attachments);
    return {
      message: (body.message as string) ?? '',
      attachments,
      conversationId: (body.conversationId as string) ?? undefined,
      participant: body.participant as AgentInput['participant'] | undefined,
      context: { source: 'chat' },
    };
  }
}
