import { AgentInput, AgentOutput, ChannelInterface } from '../agent/types.js';

/**
 * Mock channel for testing agents without external integrations.
 * Simulates a channel that can receive messages and capture outputs.
 *
 * @example
 * ```ts
 * const mockChannel = new MockChannel();
 *
 * // Simulate an incoming message
 * await mockChannel.receive({
 *   message: 'Analyse this week\'s leads',
 *   intent: 'morning_analysis',
 *   conversationId: 'test-thread-1',
 * });
 *
 * // Assert what the agent sent back
 * expect(mockChannel.lastOutput?.output).toContain('leads');
 * expect(mockChannel.outputs).toHaveLength(1);
 * ```
 */
export class MockChannel implements ChannelInterface {
  name = 'mock-channel';
  isTriggerChannel = false;

  private _handler?: (input: AgentInput) => Promise<void>;
  private _outputs: AgentOutput[] = [];
  private _inputs: AgentInput[] = [];
  private _listening = false;

  /**
   * All outputs sent to this channel.
   */
  get outputs(): AgentOutput[] {
    return [...this._outputs];
  }

  /**
   * The most recent output sent to this channel, or undefined if none.
   */
  get lastOutput(): AgentOutput | undefined {
    return this._outputs[this._outputs.length - 1];
  }

  /**
   * All inputs received by this channel.
   */
  get inputs(): AgentInput[] {
    return [...this._inputs];
  }

  /**
   * The most recent input received by this channel, or undefined if none.
   */
  get lastInput(): AgentInput | undefined {
    return this._inputs[this._inputs.length - 1];
  }

  /**
   * Number of messages received.
   */
  get receivedCount(): number {
    return this._inputs.length;
  }

  /**
   * Number of outputs sent.
   */
  get sentCount(): number {
    return this._outputs.length;
  }

  /**
   * Whether the channel is currently "listening".
   */
  get isListening(): boolean {
    return this._listening;
  }

  /**
   * Set the message handler. Called by AgentRegistry.
   */
  onMessage(handler: (input: AgentInput) => Promise<void>): void {
    this._handler = handler;
  }

  /**
   * Start listening. Called by AgentRegistry.
   * For MockChannel, this just sets a flag.
   */
  listen(): void {
    this._listening = true;
  }

  /**
   * Stop listening.
   */
  stop(): void {
    this._listening = false;
  }

  /**
   * Send output to this channel.
   * Captures the output for later assertions.
   */
  async send(output: AgentOutput): Promise<void> {
    this._outputs.push(output);
  }

  /**
   * Normalize an incoming event into AgentInput.
   */
  normalize(incoming: unknown): AgentInput {
    const data = incoming as Record<string, unknown>;
    return {
      intent: data.intent as string | undefined,
      message: data.message as string | undefined,
      data: data.data,
      context: (data.context as Record<string, unknown>) || {},
      conversationId: (data.conversationId as string) || 'test-conversation-1',
    };
  }

  /**
   * Simulate receiving a message on this channel.
   * Normalizes the input and invokes the registered handler.
   *
   * @param incoming The raw incoming message data
   * @returns A promise that resolves when the handler completes
   * @throws If no handler is registered (channel not wired to agent)
   */
  async receive(incoming: unknown): Promise<void> {
    if (!this._handler) {
      throw new Error('MockChannel: no message handler registered. Call onMessage() first or ensure channel is registered with AgentRegistry.');
    }

    const input = this.normalize(incoming);
    this._inputs.push(input);
    await this._handler(input);
  }

  /**
   * Simulate receiving a message with a specific conversation ID.
   *
   * @param message The message text
   * @param conversationId The conversation ID
   * @param intent Optional intent
   * @param context Optional context
   */
  async receiveMessage(
    message: string,
    conversationId = 'test-conversation-1',
    intent?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.receive({
      message,
      conversationId,
      intent,
      context,
    });
  }

  /**
   * Clear all captured inputs and outputs.
   */
  clear(): void {
    this._inputs = [];
    this._outputs = [];
  }

  /**
   * Assert that an output containing the given text was sent.
   *
   * @param text The text to search for
   * @throws If no matching output is found
   */
  assertOutputContains(text: string): void {
    const found = this._outputs.some(o => o.output.includes(text));
    if (!found) {
      throw new Error(`MockChannel: no output containing "${text}" found. Outputs: ${JSON.stringify(this._outputs.map(o => o.output))}`);
    }
  }

  /**
   * Assert that the last output matches the expected text.
   *
   * @param expected The expected text
   * @throws If the last output doesn't match
   */
  assertLastOutput(expected: string): void {
    const last = this.lastOutput;
    if (!last) {
      throw new Error(`MockChannel: no output sent. Expected: "${expected}"`);
    }
    if (last.output !== expected) {
      throw new Error(`MockChannel: last output mismatch.\nExpected: "${expected}"\nActual: "${last.output}"`);
    }
  }
}
