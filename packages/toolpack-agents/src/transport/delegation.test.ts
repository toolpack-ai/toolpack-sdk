import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { LocalTransport } from './local-transport.js';
import { JsonRpcTransport } from './jsonrpc-transport.js';
import { AgentJsonRpcServer } from './jsonrpc-server.js';
import type { AgentInput, AgentResult } from '../agent/types.js';
import type { Toolpack } from 'toolpack-sdk';

// Mock Toolpack
const createMockToolpack = (): Toolpack => ({
  generate: vi.fn().mockResolvedValue({ content: 'Mock response' }),
} as unknown as Toolpack);

// Test agents
class DataAgent extends BaseAgent {
  name = 'data-agent';
  description = 'Generates data reports';
  mode = 'code';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return {
      output: `Data report for: ${input.message}`,
      metadata: { delegatedBy: input.context?.delegatedBy },
    };
  }
}

class EmailAgent extends BaseAgent {
  name = 'email-agent';
  description = 'Sends emails';
  mode = 'chat';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Test delegation
    if (input.message?.includes('with report')) {
      const report = await this.delegateAndWait('data-agent', {
        message: 'Generate weekly report',
        intent: 'generate_report',
      });
      return {
        output: `Email sent with: ${report.output}`,
      };
    }

    return {
      output: `Email sent: ${input.message}`,
    };
  }
}

class CoordinatorAgent extends BaseAgent {
  name = 'coordinator';
  description = 'Coordinates other agents';
  mode = 'chat';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Fire-and-forget delegation
    await this.delegate('data-agent', {
      message: 'Background task',
    });

    return {
      output: 'Coordinator task complete',
    };
  }
}

describe('Agent Delegation', () => {
  describe('LocalTransport (same process)', () => {
    let toolpack: Toolpack;
    let registry: AgentRegistry;

    beforeEach(() => {
      toolpack = createMockToolpack();
      registry = new AgentRegistry([
        { agent: DataAgent, channels: [] },
        { agent: EmailAgent, channels: [] },
        { agent: CoordinatorAgent, channels: [] },
      ]);
      registry.start(toolpack);
    });

    it('should delegate to another agent and wait for result', async () => {
      const emailAgent = registry.getAgent('email-agent');
      expect(emailAgent).toBeDefined();

      const result = await emailAgent!.invokeAgent({
        message: 'Send email with report',
        conversationId: 'test-1',
      });

      expect(result.output).toContain('Email sent with:');
      expect(result.output).toContain('Data report for: Generate weekly report');
    });

    it('should include delegatedBy in context', async () => {
      const dataAgent = registry.getAgent('data-agent');
      const emailAgent = registry.getAgent('email-agent');
      
      // Manually test delegation with context
      const result = await (emailAgent as any).delegateAndWait('data-agent', {
        message: 'Generate report',
      });

      expect(result.metadata?.delegatedBy).toBe('email-agent');
    });

    it('should support fire-and-forget delegation', async () => {
      const coordinator = registry.getAgent('coordinator');
      const result = await coordinator!.invokeAgent({
        message: 'Start coordination',
        conversationId: 'test-3',
      });

      expect(result.output).toBe('Coordinator task complete');
    });

    it('should throw error if agent not found', async () => {
      const transport = new LocalTransport(registry);
      
      await expect(
        transport.invoke('non-existent-agent', {
          message: 'test',
          conversationId: 'test-4',
        })
      ).rejects.toThrow('Agent "non-existent-agent" not found');
    });

    it('should throw error if registry not set', async () => {
      const agent = new DataAgent(toolpack);
      // Don't register with registry
      
      await expect(
        (agent as any).delegateAndWait('email-agent', { message: 'test' })
      ).rejects.toThrow('Agent not registered');
    });
  });

  describe('JsonRpcTransport (cross-process)', () => {
    let server: AgentJsonRpcServer;
    let toolpack: Toolpack;
    const SERVER_PORT = 3456;

    beforeEach(async () => {
      toolpack = createMockToolpack();
      
      // Start JSON-RPC server with agents
      server = new AgentJsonRpcServer({ port: SERVER_PORT });
      server.registerAgent('data-agent', new DataAgent(toolpack));
      server.listen();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should invoke remote agent via JSON-RPC', async () => {
      const transport = new JsonRpcTransport({
        agents: {
          'data-agent': `http://localhost:${SERVER_PORT}`,
        },
      });

      const result = await transport.invoke('data-agent', {
        message: 'Generate report',
        conversationId: 'test-rpc-1',
      });

      expect(result.output).toBe('Data report for: Generate report');
    });

    it('should work with AgentRegistry using JsonRpcTransport', async () => {
      const transport = new JsonRpcTransport({
        agents: {
          'data-agent': `http://localhost:${SERVER_PORT}`,
        },
      });

      const registry = new AgentRegistry([
        { agent: EmailAgent, channels: [] },
      ], { transport });
      registry.start(toolpack);

      const emailAgent = registry.getAgent('email-agent');
      const result = await emailAgent!.invokeAgent({
        message: 'Send email with report',
        conversationId: 'test-rpc-2',
      });

      expect(result.output).toContain('Email sent with:');
      expect(result.output).toContain('Data report for:');
    });

    it('should throw error if agent not in transport config', async () => {
      const transport = new JsonRpcTransport({
        agents: {
          'data-agent': `http://localhost:${SERVER_PORT}`,
        },
      });

      await expect(
        transport.invoke('non-existent-agent', {
          message: 'test',
          conversationId: 'test-rpc-3',
        })
      ).rejects.toThrow('Agent "non-existent-agent" not found in transport configuration');
    });

    it('should throw error if server returns error', async () => {
      const transport = new JsonRpcTransport({
        agents: {
          'unknown-agent': `http://localhost:${SERVER_PORT}`,
        },
      });

      await expect(
        transport.invoke('unknown-agent', {
          message: 'test',
          conversationId: 'test-rpc-4',
        })
      ).rejects.toThrow('JSON-RPC error');
    });

    it('should throw error if server is unreachable', async () => {
      const transport = new JsonRpcTransport({
        agents: {
          'data-agent': 'http://localhost:9999', // Wrong port
        },
      });

      await expect(
        transport.invoke('data-agent', {
          message: 'test',
          conversationId: 'test-rpc-5',
        })
      ).rejects.toThrow('Failed to invoke agent');
    });
  });

  describe('Hybrid (Local + Remote)', () => {
    let server: AgentJsonRpcServer;
    let toolpack: Toolpack;
    const SERVER_PORT = 3457;

    beforeEach(async () => {
      toolpack = createMockToolpack();
      
      // Start JSON-RPC server with DataAgent
      server = new AgentJsonRpcServer({ port: SERVER_PORT });
      server.registerAgent('data-agent', new DataAgent(toolpack));
      server.listen();

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should support hybrid local and remote agents', async () => {
      // EmailAgent is local, DataAgent is remote
      const transport = new JsonRpcTransport({
        agents: {
          'data-agent': `http://localhost:${SERVER_PORT}`,
        },
      });

      const registry = new AgentRegistry([
        { agent: EmailAgent, channels: [] },
      ], { transport });
      registry.start(toolpack);

      const emailAgent = registry.getAgent('email-agent');
      const result = await emailAgent!.invokeAgent({
        message: 'Send email with report',
        conversationId: 'test-hybrid-1',
      });

      expect(result.output).toContain('Email sent with:');
      expect(result.output).toContain('Data report for:');
    });
  });

  describe('JSON-RPC Server', () => {
    let server: AgentJsonRpcServer;
    let toolpack: Toolpack;
    const SERVER_PORT = 3458;

    beforeEach(() => {
      toolpack = createMockToolpack();
      server = new AgentJsonRpcServer({ port: SERVER_PORT });
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should register multiple agents', () => {
      server.registerAgent('data-agent', new DataAgent(toolpack));
      server.registerAgent('email-agent', new EmailAgent(toolpack));
      
      expect((server as any).agents.size).toBe(2);
    });

    it('should handle invalid JSON-RPC requests', async () => {
      server.registerAgent('data-agent', new DataAgent(toolpack));
      server.listen();
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`http://localhost:${SERVER_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '1.0', // Wrong version
          method: 'agent.invoke:data-agent',
          params: { message: 'test' },
          id: 1,
        }),
      });

      const result = await response.json();
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Invalid Request');
    });

    it('should handle unknown methods', async () => {
      server.registerAgent('data-agent', new DataAgent(toolpack));
      server.listen();
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`http://localhost:${SERVER_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'unknown.method',
          params: { message: 'test' },
          id: 1,
        }),
      });

      const result = await response.json();
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Method not found');
    });
  });
});
