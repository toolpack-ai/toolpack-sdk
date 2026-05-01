import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResearchAgent } from './research-agent.js';
import type { Toolpack } from 'toolpack-sdk';

const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Research findings: Edge AI is rapidly evolving...',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    setMode: vi.fn(),
    registerMode: vi.fn(),
  } as unknown as Toolpack;
};

describe('ResearchAgent', () => {
  let mockToolpack: Toolpack;
  let agent: ResearchAgent;

  beforeEach(() => {
    mockToolpack = createMockToolpack();
    agent = new ResearchAgent({ toolpack: mockToolpack });
  });

  it('should have correct configuration', () => {
    expect(agent.name).toBe('research-agent');
    expect(agent.description).toContain('research');
    expect(agent.mode.name).toBe('research-agent-mode');
  });

  it('should have research-focused system prompt', () => {
    expect(agent.mode.systemPrompt).toContain('research');
    expect(agent.mode.systemPrompt).toContain('web.search');
    expect(agent.mode.systemPrompt).toContain('sources');
  });

  it('should invoke agent with message', async () => {
    const input = {
      message: 'Research recent developments in edge AI',
    };

    const result = await agent.invokeAgent(input);

    expect(mockToolpack.setMode).toHaveBeenCalledWith('research-agent-mode');
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
