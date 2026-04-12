import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduledChannel, ScheduledChannelConfig } from './scheduled-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

describe('ScheduledChannel', () => {
  const baseConfig: ScheduledChannelConfig = {
    cron: '0 9 * * 1-5',
    notify: 'slack:#ops',
  };

  describe('constructor', () => {
    it('should create with required config', () => {
      const channel = new ScheduledChannel(baseConfig);
      expect(channel).toBeDefined();
    });

    it('should set name from config', () => {
      const channel = new ScheduledChannel({ ...baseConfig, name: 'morning-report' });
      expect(channel.name).toBe('morning-report');
    });

    it('should parse cron expression', () => {
      const channel = new ScheduledChannel(baseConfig);
      // Just verify it doesn't throw
      expect(channel).toBeDefined();
    });

    it('should throw on invalid cron expression', () => {
      expect(() => {
        new ScheduledChannel({
          cron: 'invalid',
          notify: 'slack:#ops',
        });
      }).toThrow('Invalid cron expression');
    });
  });

  describe('normalize', () => {
    it('should create AgentInput with pre-set intent', () => {
      const channel = new ScheduledChannel({
        ...baseConfig,
        intent: 'daily_report',
      });

      const input = channel.normalize(null);

      expect(input.intent).toBe('daily_report');
      expect(input.message).toContain('Scheduled task triggered');
    });

    it('should have isTriggerChannel set to true', () => {
      const channel = new ScheduledChannel(baseConfig);
      expect(channel.isTriggerChannel).toBe(true);
    });

    it('should include date-keyed conversationId', () => {
      const channel = new ScheduledChannel(baseConfig);

      const input = channel.normalize(null);

      // Should be in format: scheduled:{name}:{date}
      expect(input.conversationId).toMatch(/^scheduled:/);
    });

    it('should include scheduled metadata in data', () => {
      const channel = new ScheduledChannel(baseConfig);

      const input = channel.normalize(null);

      expect(input.data).toMatchObject({
        scheduled: true,
        cron: '0 9 * * 1-5',
      });
      expect(input.data).toHaveProperty('timestamp');
    });
  });

  describe('send', () => {
    it('should throw for slack notification without proper setup', async () => {
      const channel = new ScheduledChannel(baseConfig);

      await expect(channel.send({
        output: 'Daily report',
        metadata: {},
      })).rejects.toThrow('Slack notification requires configuration');
    });

    it('should send to webhook URL', async () => {
      const channel = new ScheduledChannel({
        cron: '0 * * * *',
        notify: 'webhook:https://hooks.example.com/report',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ success: true }),
      } as unknown as Response);

      await channel.send({
        output: 'Scheduled task complete',
        metadata: { task: 'cleanup' },
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/report',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      // Verify the body contains the expected data
      const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.output).toBe('Scheduled task complete');
      expect(body.metadata).toEqual({ task: 'cleanup' });
      expect(body.timestamp).toBeDefined();
    });

    it('should throw on invalid notify format', async () => {
      const channel = new ScheduledChannel({
        cron: '0 * * * *',
        notify: 'invalid',
      });

      await expect(channel.send({ output: 'test' }))
        .rejects.toThrow('Invalid notify format');
    });

    it('should throw on unknown protocol', async () => {
      const channel = new ScheduledChannel({
        cron: '0 * * * *',
        notify: 'unknown:destination',
      });

      await expect(channel.send({ output: 'test' }))
        .rejects.toThrow('Unknown notify protocol');
    });

    it('should throw on webhook failure', async () => {
      const channel = new ScheduledChannel({
        cron: '0 * * * *',
        notify: 'webhook:https://hooks.example.com/fail',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
      } as Response);

      await expect(channel.send({ output: 'test' }))
        .rejects.toThrow('Webhook notification failed: Server Error');
    });
  });

  describe('cron parsing', () => {
    it('should parse standard cron with 5 parts', () => {
      const channel = new ScheduledChannel({
        cron: '0 9 * * 1-5',
        notify: 'slack:#ops',
      });

      expect(channel).toBeDefined();
    });

    it('should support wildcards', () => {
      const channel = new ScheduledChannel({
        cron: '* * * * *',
        notify: 'slack:#ops',
      });

      expect(channel).toBeDefined();
    });

    it('should support step values (every 15 minutes)', () => {
      const channel = new ScheduledChannel({
        cron: '*/15 * * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support ranges (9am-5pm)', () => {
      const channel = new ScheduledChannel({
        cron: '0 9-17 * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support lists (specific minutes)', () => {
      const channel = new ScheduledChannel({
        cron: '0,15,30,45 * * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support combinations (every 5 min from 0-30)', () => {
      const channel = new ScheduledChannel({
        cron: '0-30/5 * * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support complex expressions (business hours)', () => {
      const channel = new ScheduledChannel({
        cron: '*/15 9-17 * * 1-5',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support specific days of week', () => {
      const channel = new ScheduledChannel({
        cron: '0 10 * * 1,3,5',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support specific days of month', () => {
      const channel = new ScheduledChannel({
        cron: '0 0 1,15 * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support specific months', () => {
      const channel = new ScheduledChannel({
        cron: '0 9 1 1,6,12 *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support midnight cron', () => {
      const channel = new ScheduledChannel({
        cron: '0 0 * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });

    it('should support noon cron', () => {
      const channel = new ScheduledChannel({
        cron: '0 12 * * *',
        notify: 'console',
      });

      expect(channel).toBeDefined();
    });
  });

  describe('listen', () => {
    it('should schedule next run', () => {
      const channel = new ScheduledChannel(baseConfig);

      // Just verify listen doesn't throw
      expect(() => channel.listen()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should clear timer if set', async () => {
      const channel = new ScheduledChannel(baseConfig);

      // Start listening to set up timer
      channel.listen();

      // Should not throw
      await expect(channel.stop()).resolves.not.toThrow();
    });

    it('should handle missing timer gracefully', async () => {
      const channel = new ScheduledChannel(baseConfig);

      await expect(channel.stop()).resolves.not.toThrow();
    });
  });
});
