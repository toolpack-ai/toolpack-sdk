import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserAgent } from './browser-agent.js';
import type { Toolpack } from 'toolpack-sdk';

const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Form filled successfully',
      usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
    }),
    setMode: vi.fn(),
    registerMode: vi.fn(),
  } as unknown as Toolpack;
};

describe('BrowserAgent', () => {
  let mockToolpack: Toolpack;
  let agent: BrowserAgent;

  beforeEach(() => {
    mockToolpack = createMockToolpack();
    agent = new BrowserAgent({ toolpack: mockToolpack });
  });

  it('should have correct configuration', () => {
    expect(agent.name).toBe('browser-agent');
    expect(agent.description).toContain('Browser');
    expect(agent.mode.name).toBe('browser-agent-mode');
  });

  it('should have browser-focused system prompt', () => {
    expect(agent.mode.systemPrompt).toContain('browser');
    expect(agent.mode.systemPrompt).toContain('web.fetch');
    expect(agent.mode.systemPrompt).toContain('extraction');
  });

  it('should invoke agent with browser task', async () => {
    const input = {
      message: 'Fill in the contact form at acme.com/contact',
    };

    const result = await agent.invokeAgent(input);

    expect(mockToolpack.setMode).toHaveBeenCalledWith('browser-agent-mode');
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
