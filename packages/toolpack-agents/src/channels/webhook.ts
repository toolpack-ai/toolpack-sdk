import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for WebhookChannel.
 */
export interface WebhookChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** HTTP path to listen on (e.g., '/agent/support') */
  path: string;

  /** Optional port for the HTTP server (default: 3000) */
  port?: number;
}

/**
 * Pending response for webhook requests.
 */
interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Webhook channel that exposes an HTTP endpoint.
 * Receives HTTP requests and responds with agent output.
 */
export class WebhookChannel extends BaseChannel {
  readonly isTriggerChannel = false;
  private config: WebhookChannelConfig;
  private server?: any; // HTTP server instance
  private pendingResponses: Map<string, PendingResponse> = new Map();

  constructor(config: WebhookChannelConfig) {
    super();
    this.config = {
      port: 3000,
      path: '/webhook',
      ...config,
    };
    this.name = config.name;
  }

  /**
   * Start listening for HTTP requests.
   */
  listen(): void {
    if (typeof process !== 'undefined') {
      import('http').then((http) => {
        this.server = http.createServer((req, res) => {
          this.handleRequest(req, res);
        });

        this.server.listen(this.config.port, () => {
          console.log(`[WebhookChannel] Listening on port ${this.config.port}${this.config.path}`);
        });
      }).catch((err) => {
        console.error('[WebhookChannel] Failed to start HTTP server:', err);
      });
    }
  }

  /**
   * Send the agent output as an HTTP response.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    // In webhook mode, we need to find the pending response for this request
    // The conversationId from the input is used as the lookup key
    const conversationId = output.metadata?.conversationId as string | undefined;

    if (conversationId && this.pendingResponses.has(conversationId)) {
      const pending = this.pendingResponses.get(conversationId)!;
      this.pendingResponses.delete(conversationId);

      pending.resolve({
        output: output.output,
        metadata: output.metadata,
      });
    }
  }

  /**
   * Normalize an HTTP request into AgentInput.
   * @param incoming HTTP request body with headers
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput {
    const body = incoming as Record<string, unknown>;

    // Extract session ID from x-session-id header, body, or auto-generate
    const headers = (body.headers as Record<string, string>) || {};
    const sessionId = headers['x-session-id'] ||
                      headers['X-Session-Id'] ||
                      (body.sessionId as string) ||
                      (body.conversationId as string) ||
                      this.generateSessionId();

    return {
      message: (body.message as string) || (body.text as string) || '',
      intent: body.intent as string | undefined,
      conversationId: sessionId,
      data: body,
      context: {
        headers: body.headers,
        method: body.method,
        sessionId, // Store for reference
      },
    };
  }

  /**
   * Handle incoming HTTP requests.
   */
  private handleRequest(req: any, res: any): void {
    // Check path match
    if (req.url !== this.config.path) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const input = this.normalize(payload);

        // Store the response resolver for later
        const sessionId = input.conversationId || this.generateSessionId();

        const responsePromise = new Promise((resolve, reject) => {
          this.pendingResponses.set(sessionId, { resolve, reject });

          // Set a timeout to reject if no response comes
          setTimeout(() => {
            if (this.pendingResponses.has(sessionId)) {
              this.pendingResponses.delete(sessionId);
              reject(new Error('Agent response timeout'));
            }
          }, 30000); // 30 second timeout
        });

        // Ensure conversationId is in metadata for send() to find the response
        this.handleMessage({
          ...input,
          conversationId: sessionId,
          context: {
            ...input.context,
            sessionId,
          },
        });

        // Wait for the agent response
        responsePromise
          .then((result) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          });
      } catch (error) {
        console.error('[WebhookChannel] Error handling request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
  }

  /**
   * Generate a unique session ID.
   */
  private generateSessionId(): string {
    return `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}
