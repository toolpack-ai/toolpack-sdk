import { describe, it, expect, vi } from 'vitest';
import { IntentClassifierAgent, IntentClassifierInput, IntentClassification } from './intent-classifier-agent.js';
import { AgentResult } from '../agent/types.js';

// Mock Toolpack
function createMockToolpack(generateResult: string) {
  return {
    setMode: vi.fn(),
    registerMode: vi.fn(),
    generate: vi.fn().mockResolvedValue({
      content: generateResult,
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 }
    })
  } as unknown as import('toolpack-sdk').Toolpack;
}

describe('IntentClassifierAgent', () => {
  describe('DM short-circuit', () => {
    it('returns direct without LLM call when isDirectMessage is true', async () => {
      const toolpack = createMockToolpack('passive');
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: {
          message: 'Hello there',
          agentName: 'assistant',
          agentId: 'U123',
          senderName: 'alice',
          channelName: 'dm-alice',
          isDirectMessage: true
        } as IntentClassifierInput
      });

      expect(result.output).toBe('direct');
      expect(result.metadata).toEqual({
        classification: 'direct',
        shortCircuit: 'dm'
      });
      expect(toolpack.generate).not.toHaveBeenCalled();
    });

    it('short-circuits even when message is empty', async () => {
      const toolpack = createMockToolpack('ignore');
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: {
          message: '',
          agentName: 'assistant',
          agentId: 'U123',
          senderName: 'alice',
          channelName: 'dm-alice',
          isDirectMessage: true
        } as IntentClassifierInput
      });

      expect(result.output).toBe('direct');
      expect(toolpack.generate).not.toHaveBeenCalled();
    });
  });

  describe('missing payload', () => {
    it('returns ignore when no message provided', async () => {
      const toolpack = createMockToolpack('direct');
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: undefined
      });

      expect(result.output).toBe('ignore');
      expect(result.metadata).toEqual({ error: 'No message provided for classification' });
      expect(toolpack.generate).not.toHaveBeenCalled();
    });

    it('returns ignore when message is empty string', async () => {
      const toolpack = createMockToolpack('direct');
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: {
          message: '',
          agentName: 'assistant',
          agentId: 'U123',
          senderName: 'alice',
          channelName: 'general',
          isDirectMessage: false
        } as IntentClassifierInput
      });

      expect(result.output).toBe('ignore');
      expect(toolpack.generate).not.toHaveBeenCalled();
    });
  });

  describe('normalizeClassification', () => {
    async function testNormalization(
      llmOutput: string,
      expected: IntentClassification
    ): Promise<void> {
      const toolpack = createMockToolpack(llmOutput);
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: {
          message: 'test message',
          agentName: 'assistant',
          agentId: 'U123',
          senderName: 'bob',
          channelName: 'general',
          isDirectMessage: false
        } as IntentClassifierInput
      });

      expect(result.output).toBe(expected);
    }

    describe('exact first-word matches', () => {
      it('normalizes "direct" to direct', async () => {
        await testNormalization('direct', 'direct');
      });

      it('normalizes "indirect" to indirect', async () => {
        await testNormalization('indirect', 'indirect');
      });

      it('normalizes "passive" to passive', async () => {
        await testNormalization('passive', 'passive');
      });

      it('normalizes "ignore" to ignore', async () => {
        await testNormalization('ignore', 'ignore');
      });

      it('handles uppercase first word', async () => {
        await testNormalization('Direct', 'direct');
      });

      it('handles mixed case first word', async () => {
        await testNormalization('InDiReCt', 'indirect');
      });
    });

    describe('first word with trailing text', () => {
      it('extracts direct from "direct - clearly addressing the agent"', async () => {
        await testNormalization('direct - clearly addressing the agent', 'direct');
      });

      it('extracts indirect from "indirect, the user is mentioning"', async () => {
        await testNormalization('indirect, the user is mentioning', 'indirect');
      });

      it('extracts passive from "passive: no addressing detected"', async () => {
        await testNormalization('passive: no addressing detected', 'passive');
      });
    });

    describe('fuzzy fallback on full output', () => {
      it('detects "direct" in full sentence "The message is directly addressing"', async () => {
        await testNormalization('The message is directly addressing', 'direct');
      });

      it('detects "addressed" keyword for direct', async () => {
        await testNormalization('This is clearly addressed to the bot', 'direct');
      });

      it('detects "indirect" in full sentence', async () => {
        await testNormalization('The message is indirectly referring', 'indirect');
      });

      it('detects "mention" keyword for indirect', async () => {
        await testNormalization('Just mentioning the agent here', 'indirect');
      });

      it('detects "passive" in full sentence', async () => {
        await testNormalization('The agent should passively observe', 'passive');
      });

      it('detects "listen" keyword for passive', async () => {
        await testNormalization('Agent should just listen', 'passive');
      });

      it('detects "ignore" in full sentence', async () => {
        await testNormalization('This message should be ignored', 'ignore');
      });

      it('detects "skip" keyword for ignore', async () => {
        await testNormalization('Skip this message', 'ignore');
      });
    });

    describe('unrecognized output', () => {
      it('defaults to ignore for empty string', async () => {
        await testNormalization('', 'ignore');
      });

      it('defaults to ignore for whitespace', async () => {
        await testNormalization('   ', 'ignore');
      });

      it('defaults to ignore for random text', async () => {
        await testNormalization('I am a large language model', 'ignore');
      });

      it('defaults to ignore for "yes" (no keyword match)', async () => {
        await testNormalization('yes', 'ignore');
      });
    });
  });

  describe('metadata', () => {
    it('includes raw output and confidence in metadata', async () => {
      const toolpack = createMockToolpack('direct response here');
      const agent = new IntentClassifierAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'classify',
        data: {
          message: '@assistant help',
          agentName: 'assistant',
          agentId: 'U123',
          senderName: 'alice',
          channelName: 'general',
          isDirectMessage: false
        } as IntentClassifierInput
      });

      expect(result.metadata).toMatchObject({
        rawOutput: 'direct response here',
        classification: 'direct',
        confidence: 'high'
      });
    });
  });
});
