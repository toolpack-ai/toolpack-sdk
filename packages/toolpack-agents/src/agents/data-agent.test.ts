import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataAgent } from './data-agent.js';
import type { Toolpack } from 'toolpack-sdk';

const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Weekly signup summary generated',
      usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
    }),
    setMode: vi.fn(),
  } as unknown as Toolpack;
};

describe('DataAgent', () => {
  let mockToolpack: Toolpack;
  let agent: DataAgent;

  beforeEach(() => {
    mockToolpack = createMockToolpack();
    agent = new DataAgent(mockToolpack);
  });

  it('should have correct configuration', () => {
    expect(agent.name).toBe('data-agent');
    expect(agent.description).toContain('data');
    expect(agent.mode).toBe('agent');
  });

  it('should have data-focused system prompt', () => {
    expect(agent.systemPrompt).toContain('data');
    expect(agent.systemPrompt).toContain('db.*');
    expect(agent.systemPrompt).toContain('analysis');
  });

  it('should invoke agent with data task', async () => {
    const input = {
      message: 'Generate a weekly summary of signups by region',
    };

    const result = await agent.invokeAgent(input);

    expect(mockToolpack.setMode).toHaveBeenCalledWith('agent');
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
