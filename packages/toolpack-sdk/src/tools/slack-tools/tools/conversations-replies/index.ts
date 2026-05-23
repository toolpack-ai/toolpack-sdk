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
}

async function execute(args: Record<string, any>): Promise<string> {
  const channel = String(args.channel);
  const ts = String(args.ts);
  const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 20;
  const token = resolveSlackToken(args.token as string | undefined);

  const body: Record<string, unknown> = { channel, ts, limit };
  if (args.oldest) body.oldest = String(args.oldest);
  if (args.latest) body.latest = String(args.latest);

  const data = await callSlackApi('conversations.replies', token, body);
  const messages = (data.messages as SlackMessage[] | undefined) ?? [];

  if (messages.length === 0) return 'No replies found.';

  // Slack returns messages in chronological order (oldest first).
  // The first message is the parent; the rest are the replies.
  const lines = messages.map((m, i) => {
    const who = m.user ? `user:${m.user}` : m.bot_id ? `bot:${m.bot_id}` : 'unknown';
    const role = i === 0 ? ' [parent]' : '';
    const text = (m.text ?? '').replace(/\n/g, ' ').slice(0, 200);
    return `[${m.ts}] ${who}${role}: ${text}`;
  });

  return lines.join('\n');
}

export const slackConversationsRepliesTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
