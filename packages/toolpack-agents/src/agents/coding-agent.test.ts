import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodingAgent } from './coding-agent.js';
import type { Toolpack } from 'toolpack-sdk';

const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Code changes completed successfully',
      usage: { prompt_tokens: 150, completion_tokens: 75, total_tokens: 225 },
    }),
    setMode: vi.fn(),
  } as unknown as Toolpack;
};

describe('CodingAgent', () => {
  let mockToolpack: Toolpack;
  let agent: CodingAgent;

  beforeEach(() => {
    mockToolpack = createMockToolpack();
    agent = new CodingAgent(mockToolpack);
  });

  it('should have correct configuration', () => {
    expect(agent.name).toBe('coding-agent');
    expect(agent.description).toContain('Coding');
    expect(agent.mode).toBe('coding');
  });

  it('should have coding-focused system prompt', () => {
    expect(agent.systemPrompt).toContain('coding');
    expect(agent.systemPrompt).toContain('coding.*');
    expect(agent.systemPrompt).toContain('best practices');
  });

  it('should invoke agent with coding task', async () => {
    const input = {
      message: 'Refactor the auth module to use the new SDK pattern',
    };

    const result = await agent.invokeAgent(input);

    expect(mockToolpack.setMode).toHaveBeenCalledWith('coding');
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should handle empty message', async () => {
    const input = {
      message: undefined,
    };

    const result = await agent.invokeAgent(input);

    expect(result).toBeDefined();
  });
});
