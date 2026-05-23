import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { resolveSlackToken } from '../../auth.js';
import { callSlackApi } from '../../common.js';

async function execute(args: Record<string, any>): Promise<string> {
  const channel = String(args.channel);
  const text = String(args.text);
  const threadTs = args.thread_ts ? String(args.thread_ts) : undefined;
  const blocksRaw = args.blocks ? String(args.blocks) : undefined;
  const token = resolveSlackToken(args.token as string | undefined);

  const body: Record<string, unknown> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;
  if (blocksRaw) {
    try {
      body.blocks = JSON.parse(blocksRaw);
    } catch {
      return 'Error: blocks is not valid JSON.';
    }
  }

  const data = await callSlackApi('chat.postMessage', token, body);
  const ts = (data.ts as string | undefined) ?? '';
  const ch = (data.channel as string | undefined) ?? channel;
  return `Message posted. channel=${ch} ts=${ts}`;
}

export const slackChatPostMessageTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
