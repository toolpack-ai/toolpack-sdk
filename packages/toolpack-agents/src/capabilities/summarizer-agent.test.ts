import { describe, it, expect, vi } from 'vitest';
import { SummarizerAgent, SummarizerInput, HistoryTurn, Participant } from './summarizer-agent.js';

// Mock Toolpack
function createMockToolpack(generateResult: string) {
  return {
    setMode: vi.fn(),
    registerMode: vi.fn(),
    generate: vi.fn().mockResolvedValue({
      content: generateResult,
      usage: { promptTokens: 200, completionTokens: 50, totalTokens: 250 }
    })
  } as unknown as import('toolpack-sdk').Toolpack;
}

function createParticipant(kind: 'user' | 'agent' | 'system', id: string, displayName?: string): Participant {
  return { kind, id, displayName };
}

function createTurn(id: string, participant: Participant, content: string, timestamp?: string): HistoryTurn {
  return {
    id,
    participant,
    content,
    timestamp: timestamp ?? new Date().toISOString()
  };
}

describe('SummarizerAgent', () => {
  describe('empty input handling', () => {
    it('returns placeholder when turns array is empty', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const output = JSON.parse(result.output);
      expect(output.summary).toBe('(No history to summarize)');
      expect(output.turnsSummarized).toBe(0);
      expect(output.hasDecisions).toBe(false);
      expect(toolpack.generate).not.toHaveBeenCalled();
    });

    it('returns placeholder when data is undefined', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const result = await agent.invokeAgent({
        message: 'summarize',
        data: undefined
      });

      const output = JSON.parse(result.output);
      expect(output.summary).toBe('(No history to summarize)');
      expect(toolpack.generate).not.toHaveBeenCalled();
    });
  });

  describe('parseSummarizerOutput', () => {
    async function testParse(
      llmOutput: string,
      turnCount: number,
      expectedSummary: string,
      expectedHasDecisions?: boolean
    ): Promise<void> {
      const toolpack = createMockToolpack(llmOutput);
      const agent = new SummarizerAgent({ toolpack });

      const user = createParticipant('user', 'U1', 'alice');
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', user, 'Hello')],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const output = JSON.parse(result.output);
      expect(output.summary).toBe(expectedSummary);
      expect(output.turnsSummarized).toBe(turnCount);
      if (expectedHasDecisions !== undefined) {
        expect(output.hasDecisions).toBe(expectedHasDecisions);
      }
      expect(output.estimatedTokens).toBeGreaterThan(0);
    }

    describe('clean JSON parsing', () => {
      it('parses clean JSON object', async () => {
        await testParse(
          '{"summary":"Key point discussed","turnsSummarized":5,"hasDecisions":true,"estimatedTokens":50}',
          5,
          'Key point discussed',
          true
        );
      });

      it('handles JSON with whitespace', async () => {
        await testParse(
          `{
            "summary": "Multi-line summary",
            "turnsSummarized": 3,
            "hasDecisions": false,
            "estimatedTokens": 40
          }`,
          3,
          'Multi-line summary',
          false
        );
      });
    });

    describe('JSON in markdown code blocks', () => {
      it('parses JSON wrapped in ```json block', async () => {
        await testParse(
          '```json\n{"summary":"From code block","turnsSummarized":4,"hasDecisions":false,"estimatedTokens":30}\n```',
          4,
          'From code block',
          false
        );
      });

      it('parses JSON wrapped in plain ``` block', async () => {
        await testParse(
          '```\n{"summary":"Plain code block","turnsSummarized":2,"hasDecisions":true,"estimatedTokens":25}\n```',
          2,
          'Plain code block',
          true
        );
      });

      it('handles code block with extra whitespace', async () => {
        await testParse(
          '```json\n\n  {"summary":"With whitespace","turnsSummarized":1,"hasDecisions":false,"estimatedTokens":20}\n\n```',
          1,
          'With whitespace',
          false
        );
      });
    });

    describe('non-JSON fallback', () => {
      it('uses fallback summary for plain text response', async () => {
        await testParse(
          'Here is a summary of the conversation that happened earlier',
          1,
          '(Summary of 1 conversation turns - key details preserved in full context)',
          false
        );
      });

      it('detects "decision" keyword for hasDecisions', async () => {
        await testParse(
          'The decision was made to proceed with the plan',
          1,
          '(Summary of 1 conversation turns - key details preserved in full context)',
          true
        );
      });

      it('detects "action" keyword for hasDecisions', async () => {
        await testParse(
          'Action items were assigned to the team',
          1,
          '(Summary of 1 conversation turns - key details preserved in full context)',
          true
        );
      });
    });

    describe('field validation', () => {
      it('uses defaults for missing fields', async () => {
        const toolpack = createMockToolpack('{"summary":"Valid"}');
        const agent = new SummarizerAgent({ toolpack });
        const user = createParticipant('user', 'U1', 'alice');

        const result = await agent.invokeAgent({
          message: 'summarize',
          data: {
            turns: [createTurn('1', user, 'Hello')],
            agentName: 'assistant',
            agentId: 'U123'
          } as SummarizerInput
        });

        const output = JSON.parse(result.output);
        expect(output.summary).toBe('Valid');
        expect(output.turnsSummarized).toBe(1); // defaults to provided count
        expect(output.hasDecisions).toBe(false); // defaults to false
        expect(output.estimatedTokens).toBeGreaterThan(0); // estimated from output length
      });

      it('uses fallback for empty summary string', async () => {
        const toolpack = createMockToolpack('{"summary":"","turnsSummarized":3}');
        const agent = new SummarizerAgent({ toolpack });
        const user = createParticipant('user', 'U1', 'alice');

        const result = await agent.invokeAgent({
          message: 'summarize',
          data: {
            turns: [createTurn('1', user, 'Hello'), createTurn('2', user, 'World'), createTurn('3', user, '!')],
            agentName: 'assistant',
            agentId: 'U123'
          } as SummarizerInput
        });

        const output = JSON.parse(result.output);
        expect(output.summary).toBe('(Summary of 3 conversation turns - key details preserved in full context)');
      });
    });
  });

  describe('prompt construction', () => {
    it('formats participant with display name', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const user = createParticipant('user', 'U1', 'Alice Smith');
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', user, 'Hello there')],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      expect(toolpack.generate).toHaveBeenCalled();
      const messages = (toolpack.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const userPrompt = messages[messages.length - 1].content;
      expect(userPrompt).toContain('Alice Smith:');
      expect(userPrompt).not.toContain('[BOT]');
    });

    it('marks agent participants with [BOT] prefix', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const bot = createParticipant('agent', 'B1', 'HelperBot');
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', bot, 'How can I help?')],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const messages = (toolpack.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const userPrompt = messages[messages.length - 1].content;
      expect(userPrompt).toContain('[BOT] HelperBot:');
    });

    it('falls back to participant id when no displayName', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const user = createParticipant('user', 'U999'); // no displayName
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', user, 'Message')],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const messages = (toolpack.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const userPrompt = messages[messages.length - 1].content;
      expect(userPrompt).toContain('U999:');
    });

    it('truncates long messages in prompt', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const user = createParticipant('user', 'U1', 'alice');
      const longMessage = 'a'.repeat(300);
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', user, longMessage)],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const messages = (toolpack.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const userPrompt = messages[messages.length - 1].content;
      expect(userPrompt).toContain('a'.repeat(200));
      expect(userPrompt).toContain('...');
      expect(userPrompt).not.toContain('a'.repeat(250));
    });

    it('includes tool call metadata when present', async () => {
      const toolpack = createMockToolpack('{"summary":"test"}');
      const agent = new SummarizerAgent({ toolpack });

      const bot = createParticipant('agent', 'B1', 'ToolBot');
      const turn: HistoryTurn = {
        id: '1',
        participant: bot,
        content: 'Searching...',
        timestamp: new Date().toISOString(),
        metadata: {
          isToolCall: true,
          toolName: 'web.search'
        }
      };

      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [turn],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      const messages = (toolpack.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const userPrompt = messages[messages.length - 1].content;
      expect(userPrompt).toContain('[tool: web.search]');
    });
  });

  describe('metadata', () => {
    it('includes turns processed count', async () => {
      const toolpack = createMockToolpack('{"summary":"Key discussion happened"}');
      const agent = new SummarizerAgent({ toolpack });

      const user = createParticipant('user', 'U1', 'alice');
      const result = await agent.invokeAgent({
        message: 'summarize',
        data: {
          turns: [createTurn('1', user, 'Hello'), createTurn('2', user, 'World')],
          agentName: 'assistant',
          agentId: 'U123'
        } as SummarizerInput
      });

      expect(result.metadata).toMatchObject({
        turnsProcessed: 2,
        rawOutputLength: expect.any(Number)
      });
    });
  });
});
