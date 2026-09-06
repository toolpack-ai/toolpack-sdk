import { AgentInput, AgentOutput } from '../agent/types.js';
import type { ImagePart, FilePart } from 'toolpack-sdk';
import { FILE_LIMITS } from 'toolpack-sdk';

/**
 * Abstract base class for all agent channels.
 * Channels handle the two-way communication between the external world and agents.
 */
export abstract class BaseChannel {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /**
   * Whether this is a trigger channel (no human recipient).
   * Trigger channels like ScheduledChannel cannot use this.ask() since there's no human to answer.
   * Conversation channels (Slack, Telegram, Webhook) can use this.ask().
   */
  abstract readonly isTriggerChannel: boolean;

  /** Message handler set by AgentRegistry */
  protected _handler?: (input: AgentInput) => Promise<void>;

  /**
   * Start listening for incoming messages.
   * Called by AgentRegistry when the SDK initializes.
   */
  abstract listen(): void;

  /**
   * Send output back to the external world.
   * @param output The agent's output to deliver
   */
  abstract send(output: AgentOutput): Promise<void>;

  /**
   * Normalize an incoming event into AgentInput.
   * Each channel implementation maps its specific event format.
   * @param incoming Raw event from the external source
   * @returns Normalized AgentInput
   */
  abstract normalize(incoming: unknown): AgentInput;

  /**
   * Set the message handler. Called by AgentRegistry.
   * @param handler Function to call when a message arrives
   */
  onMessage(handler: (input: AgentInput) => Promise<void>): void {
    this._handler = handler;
  }

  /**
   * Helper to call the handler if set.
   * @param input The normalized agent input
   */
  protected async handleMessage(input: AgentInput): Promise<void> {
    if (this._handler) {
      await this._handler(input);
    }
  }

  /**
   * Validate attachment sizes against FILE_LIMITS.
   * Call this inside normalize() for any channel that accepts attachments.
   * Throws with a descriptive message if a limit is exceeded.
   */
  protected validateAttachments(attachments: Array<ImagePart | FilePart> | undefined): void {
    if (!attachments || attachments.length === 0) return;

    for (const att of attachments) {
      if (att.type === 'file') {
        const { url, mimeType, size, name } = att.file;
        const label = name ?? url;
        const isImage = mimeType.startsWith('image/');
        const limitBytes = isImage ? FILE_LIMITS.image.maxBytes : FILE_LIMITS.document.maxBytes;
        const limitMB = limitBytes / (1024 * 1024);
        if (size !== undefined && size > limitBytes) {
          throw new Error(
            `Attachment "${label}" exceeds the ${isImage ? 'image' : 'document'} size limit of ${limitMB} MB`,
          );
        }
      } else if (att.type === 'image_data') {
        // Estimate decoded size from base64 length (base64 inflates by ~4/3)
        const approxBytes = Math.ceil(att.image_data.data.length * 0.75);
        if (approxBytes > FILE_LIMITS.image.maxBytes) {
          const limitMB = FILE_LIMITS.image.maxBytes / (1024 * 1024);
          throw new Error(`Inline image exceeds the size limit of ${limitMB} MB`);
        }
      }
      // image_url and image_file: size is unknown server-side, skip
    }
  }
}
