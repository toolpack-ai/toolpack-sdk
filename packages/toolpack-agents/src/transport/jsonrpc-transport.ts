import type { AgentInput, AgentResult } from '../agent/types.js';
import type { AgentTransport } from './types.js';
import { AgentError } from '../agent/errors.js';

/**
 * JSON-RPC 2.0 request format
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: AgentInput;
  id: string | number;
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
 * JSON-RPC transport for cross-process agent communication.
 * Calls remote agents via JSON-RPC 2.0 over HTTP.
 *
 * @example
 * ```ts
 * const transport = new JsonRpcTransport({
 *   agents: {
 *     'data-agent': 'http://localhost:3000',
 *     'research-agent': 'http://remote-server:3000',
 *   }
 * });
 *
 * const registry = new AgentRegistry(registrations, { transport });
 * ```
 */
export class JsonRpcTransport implements AgentTransport {
  private agentUrls: Map<string, string>;

  constructor(options: {
    /** Map of agent names to their JSON-RPC server URLs */
    agents: Record<string, string>;
  }) {
    this.agentUrls = new Map(Object.entries(options.agents));
  }

  async invoke(agentName: string, input: AgentInput): Promise<AgentResult> {
    const url = this.agentUrls.get(agentName);
    
    if (!url) {
      throw new AgentError(
        `Agent "${agentName}" not found in transport configuration. ` +
        `Available agents: ${Array.from(this.agentUrls.keys()).join(', ')}`
      );
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: `agent.invoke:${agentName}`,
      params: input,
      id: Date.now(),
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new AgentError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const jsonRpcResponse = await response.json() as JsonRpcResponse;

      if (jsonRpcResponse.error) {
        throw new AgentError(
          `JSON-RPC error (${jsonRpcResponse.error.code}): ${jsonRpcResponse.error.message}` +
          (jsonRpcResponse.error.data ? ` - ${JSON.stringify(jsonRpcResponse.error.data)}` : '')
        );
      }

      if (!jsonRpcResponse.result) {
        throw new AgentError('No result in JSON-RPC response');
      }

      return jsonRpcResponse.result;
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError(
        `Failed to invoke agent "${agentName}" at ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
