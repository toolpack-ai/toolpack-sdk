import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { resolveSlackToken } from '../../auth.js';
import { callSlackApi } from '../../common.js';

interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
}

async function execute(args: Record<string, any>): Promise<string> {
  const channel = String(args.channel);
  const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 10;
  const token = resolveSlackToken(args.token as string | undefined);

  const body: Record<string, unknown> = { channel, limit };
  if (args.oldest) body.oldest = String(args.oldest);
  if (args.latest) body.latest = String(args.latest);

  const data = await callSlackApi('conversations.history', token, body);
  const messages = (data.messages as SlackMessage[] | undefined) ?? [];

  if (messages.length === 0) return 'No messages found.';

  // Slack returns messages newest-first; reverse to chronological order for readability.
  const lines = [...messages].reverse().map((m) => {
    const who = m.user ? `user:${m.user}` : m.bot_id ? `bot:${m.bot_id}` : 'unknown';
    const thread = m.reply_count ? ` [thread: ${m.reply_count} replies]` : '';
    const text = (m.text ?? '').replace(/\n/g, ' ').slice(0, 200);
    return `[${m.ts}] ${who}${thread}: ${text}`;
  });

  return lines.join('\n');
}

export const slackConversationsHistoryTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
