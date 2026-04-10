import { EventEmitter } from 'events';
import type { Toolpack } from 'toolpack-sdk';
import { AgentInput, AgentResult, AgentRunOptions, WorkflowStep, IAgentRegistry } from './types.js';

/**
 * Abstract base class for all agents.
 * Extend this to create custom agents with specific behaviors.
 */
export abstract class BaseAgent<TIntent extends string = string> extends EventEmitter {
  // --- Required properties (must be set by subclasses) ---
  /** Unique agent identifier */
  abstract name: string;

  /** Human-readable description of what this agent does */
  abstract description: string;

  /** Mode this agent runs in (from toolpack-sdk modes) */
  abstract mode: string;

  // --- Optional identity properties ---
  /** System prompt injected on every run */
  systemPrompt?: string;

  /** Provider override (e.g., 'anthropic', 'openai') - inherits from Toolpack if not set */
  provider?: string;

  /** Model override - inherits from provider default if not set */
  model?: string;

  // --- Optional behavior properties ---
  /** Workflow configuration merged on top of mode config */
  workflow?: Record<string, unknown>;

  // --- Internal references (set by AgentRegistry) ---
  /** Reference to the registry for channel routing */
  _registry?: IAgentRegistry;

  /** Name of the channel that triggered this invocation */
  _triggeringChannel?: string;

  /**
   * Constructor receives the shared Toolpack instance.
   * @param toolpack The Toolpack SDK instance
   */
  constructor(protected readonly toolpack: Toolpack) {
    super();
  }

  /**
   * Main entry point for agent invocation.
   * Implement this to handle incoming messages and route to appropriate logic.
   * @param input The normalized input from the channel
   * @returns The agent's result
   */
  abstract invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;

  /**
   * Execute the agent using the Toolpack SDK.
   * This is the execution engine that bridges agents to the SDK.
   * @param message The message to process
   * @param options Optional overrides for this run
   * @returns The execution result
   */
  protected async run(message: string, _options?: AgentRunOptions): Promise<AgentResult> {
    // Fire lifecycle hooks and emit events
    await this.onBeforeRun({ message } as AgentInput<TIntent>);
    this.emit('agent:start', { message });

    try {
      // Set the agent's mode on the toolpack instance
      // This configures the workflow, system prompt, and available tools
      this.toolpack.setMode(this.mode);

      // Build the completion request
      const request = {
        messages: [{ role: 'user' as const, content: message }],
        model: this.model || '', // Empty string lets the adapter use defaults
      };

      // Call toolpack.generate() with per-agent provider override
      const result = await this.toolpack.generate(request, this.provider);

      // Convert SDK result to AgentResult
      const agentResult: AgentResult = {
        output: result.content || '',
        steps: this.extractSteps(result),
        metadata: result.usage ? { usage: result.usage } : undefined,
      };

      // Fire completion hooks and emit events
      await this.onComplete(agentResult);
      this.emit('agent:complete', agentResult);

      return agentResult;
    } catch (error) {
      // Fire error hooks and emit events
      await this.onError(error as Error);
      this.emit('agent:error', error);
      throw error;
    }
  }

  /**
   * Send a message to a named channel.
   * The channel must be registered with a name in AgentRegistry.
   * @param channelName The registered name of the target channel
   * @param message The message to send
   */
  protected async sendTo(channelName: string, message: string): Promise<void> {
    if (!this._registry) {
      throw new Error('Agent not registered - _registry not set');
    }
    await this._registry.sendTo(channelName, { output: message });
  }

  /**
   * Ask the user a question and wait for a response.
   * Phase 1 implementation: sends the question via current channel and returns a pending marker.
   * Full resumption logic lands in Phase 2 when conversationId + knowledge are available.
   * @param question The question to ask the user
   * @returns '__pending__' marker in Phase 1
   */
  protected async ask(question: string): Promise<string> {
    // Send question to triggering channel
    await this.sendTo(this._triggeringChannel ?? '', question);
    // Phase 1: return pending marker
    // Phase 2: will implement full async resumption with knowledge
    return '__pending__';
  }

  // --- Lifecycle hooks (override in subclasses) ---

  /**
   * Called before run() starts.
   * @param input The input that will be processed
   */
  async onBeforeRun(_input: AgentInput<TIntent>): Promise<void> {
    // Override in subclass for custom pre-run logic
  }

  /**
   * Called after each workflow step completes.
   * Also emits 'agent:step' event.
   * @param step The completed workflow step
   */
  async onStepComplete(_step: WorkflowStep): Promise<void> {
    // Override in subclass for custom step handling
  }

  /**
   * Called when run() completes successfully.
   * Also emits 'agent:complete' event.
   * @param result The final result
   */
  async onComplete(_result: AgentResult): Promise<void> {
    // Override in subclass for custom post-processing
  }

  /**
   * Called when run() encounters an error.
   * Also emits 'agent:error' event.
   * @param error The error that occurred
   */
  async onError(_error: Error): Promise<void> {
    // Override in subclass for custom error handling
  }

  // --- Helper methods ---

  /**
   * Extract workflow steps from the SDK result.
   * This is a placeholder that can be enhanced based on SDK response structure.
   */
  private extractSteps(result: unknown): WorkflowStep[] | undefined {
    // Attempt to extract steps from various possible result formats
    const r = result as Record<string, unknown>;

    // Check for plan with steps
    if (r.plan && typeof r.plan === 'object') {
      const plan = r.plan as Record<string, unknown>;
      if (Array.isArray(plan.steps)) {
        return plan.steps.map((step: Record<string, unknown>) => ({
          number: (step.number as number) || 0,
          description: (step.description as string) || '',
          status: (step.status as WorkflowStep['status']) || 'completed',
          result: step.result as WorkflowStep['result'],
        }));
      }
    }

    // Check for direct steps array
    if (Array.isArray(r.steps)) {
      return r.steps as WorkflowStep[];
    }

    return undefined;
  }
}

// Agent event types for TypeScript users
export interface AgentEvents {
  'agent:start': (input: AgentInput) => void;
  'agent:step': (step: WorkflowStep) => void;
  'agent:complete': (result: AgentResult) => void;
  'agent:error': (error: Error) => void;
}
