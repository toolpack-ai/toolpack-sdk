import { ToolDefinition, ToolContext } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { resolveSlackToken } from '../../auth.js';
import { callSlackApi } from '../../common.js';

async function execute(args: Record<string, any>, ctx?: ToolContext): Promise<string> {
  const channel = String(args.channel);
  const user = String(args.user);
  const text = String(args.text);
  const threadTs = args.thread_ts ? String(args.thread_ts) : undefined;
  const token = resolveSlackToken(args.token as string | undefined, ctx?.config?.credentials);

  const body: Record<string, unknown> = { channel, user, text };
  if (threadTs) body.thread_ts = threadTs;

  await callSlackApi('chat.postEphemeral', token, body);
  return `Ephemeral message sent to user=${user} in channel=${channel}.`;
}

export const slackChatPostEphemeralTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
