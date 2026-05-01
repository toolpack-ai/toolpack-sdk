import http from 'http';
import type { BaseAgent } from '../agent/base-agent.js';
import type { AgentInput, AgentResult } from '../agent/types.js';

/**
 * JSON-RPC 2.0 request format
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: AgentInput;
  id?: string | number | null;
}

/**
 * JSON-RPC 2.0 response format
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: AgentResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 server for hosting multiple agents.
 * Exposes agents via standard JSON-RPC protocol over HTTP.
 *
 * @example
 * ```ts
 * const server = new AgentJsonRpcServer({ port: 3000 });
 * server.registerAgent('data-agent', new DataAgent(toolpack));
 * server.registerAgent('email-agent', new EmailAgent(toolpack));
 * server.listen();
 * ```
 */
export class AgentJsonRpcServer {
  private agents: Map<string, BaseAgent> = new Map();
  private server?: http.Server;
  private port: number;

  constructor(options: { port: number }) {
    this.port = options.port;
  }

  /**
   * Register an agent with the server.
   * @param name The agent name (used in JSON-RPC method calls)
   * @param agent The agent instance
   */
  registerAgent(name: string, agent: BaseAgent): void {
    this.agents.set(name, agent);
  }

  /**
   * Start the JSON-RPC server.
   */
  listen(): void {
    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const request = JSON.parse(body) as JsonRpcRequest;
          const response = await this.handleRequest(request);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error',
              data: error instanceof Error ? error.message : String(error),
            },
            id: null,
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(errorResponse));
        }
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[AgentJsonRpcServer] Listening on port ${this.port}`);
      console.log(`[AgentJsonRpcServer] Registered agents: ${Array.from(this.agents.keys()).join(', ')}`);
    });
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('[AgentJsonRpcServer] Server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Handle a JSON-RPC request.
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'jsonrpc must be "2.0"',
        },
        id: request.id || null,
      };
    }

    // Parse method - format: "agent.invoke:agent-name"
    const [method, agentName] = request.method.split(':');

    if (method !== 'agent.invoke') {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found',
          data: `Unknown method: ${request.method}`,
        },
        id: request.id || null,
      };
    }

    if (!agentName) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: 'Agent name required in method (e.g., "agent.invoke:data-agent")',
        },
        id: request.id || null,
      };
    }

    const agent = this.agents.get(agentName);
    if (!agent) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: `Agent "${agentName}" not found. Available: ${Array.from(this.agents.keys()).join(', ')}`,
        },
        id: request.id || null,
      };
    }

    if (!request.params) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: 'params (AgentInput) required',
        },
        id: request.id || null,
      };
    }

    try {
      const result = await agent.invokeAgent(request.params);
      return {
        jsonrpc: '2.0',
        result,
        id: request.id || null,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
        id: request.id || null,
      };
    }
  }
}
