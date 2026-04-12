import { describe, it, expect, beforeEach } from 'vitest';
import { SMSChannel } from './sms-channel.js';

describe('SMSChannel', () => {
  describe('outbound-only configuration', () => {
    let channel: SMSChannel;

    beforeEach(() => {
      channel = new SMSChannel({
        name: 'test-sms-outbound',
        accountSid: 'AC123',
        authToken: 'token123',
        from: '+1234567890',
        to: '+0987654321',
      });
    });

    it('should have correct configuration', () => {
      expect(channel.name).toBe('test-sms-outbound');
      expect(channel.isTriggerChannel).toBe(true);
    });

    it('should be a trigger channel when no webhookPath', () => {
      expect(channel.isTriggerChannel).toBe(true);
    });
  });

  describe('two-way configuration', () => {
    let channel: SMSChannel;

    beforeEach(() => {
      channel = new SMSChannel({
        name: 'test-sms-twoway',
        accountSid: 'AC123',
        authToken: 'token123',
        from: '+1234567890',
        webhookPath: '/sms/webhook',
        port: 3001,
      });
    });

    it('should not be a trigger channel when webhookPath is set', () => {
      expect(channel.isTriggerChannel).toBe(false);
    });

    it('should normalize Twilio webhook payload', () => {
      const payload = {
        From: '+0987654321',
        To: '+1234567890',
        Body: 'Hello from SMS',
        MessageSid: 'SM123',
      };

      const input = channel.normalize(payload);

      expect(input.message).toBe('Hello from SMS');
      expect(input.conversationId).toBe('+0987654321');
      expect(input.context?.from).toBe('+0987654321');
      expect(input.context?.messageSid).toBe('SM123');
    });
  });

  it('should initialize without errors', () => {
    const channel = new SMSChannel({
      accountSid: 'AC123',
      authToken: 'token123',
      from: '+1234567890',
      to: '+0987654321',
    });

    expect(() => channel.listen()).not.toThrow();
  });
});
