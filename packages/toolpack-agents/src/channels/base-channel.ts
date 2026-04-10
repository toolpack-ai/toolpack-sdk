import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Abstract base class for all agent channels.
 * Channels handle the two-way communication between the external world and agents.
 */
export abstract class BaseChannel {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

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
}
