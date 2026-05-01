import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailChannel } from './email-channel.js';

describe('EmailChannel', () => {
  let channel: EmailChannel;

  beforeEach(() => {
    channel = new EmailChannel({
      name: 'test-email',
      from: 'agent@example.com',
      to: 'user@example.com',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        auth: {
          user: 'agent@example.com',
          pass: 'password',
        },
      },
      subject: 'Test Email',
    });
  });

  it('should have correct configuration', () => {
    expect(channel.name).toBe('test-email');
    expect(channel.isTriggerChannel).toBe(true);
  });

  it('should be a trigger channel (outbound-only)', () => {
    expect(channel.isTriggerChannel).toBe(true);
  });

  it('should throw error when normalize is called', () => {
    expect(() => channel.normalize({})).toThrow('outbound-only');
  });

  it('should support multiple recipients', () => {
    const multiChannel = new EmailChannel({
      from: 'agent@example.com',
      to: ['user1@example.com', 'user2@example.com'],
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        auth: {
          user: 'agent@example.com',
          pass: 'password',
        },
      },
    });

    expect(multiChannel).toBeDefined();
  });

  it('should initialize without errors', () => {
    expect(() => channel.listen()).not.toThrow();
  });
});
