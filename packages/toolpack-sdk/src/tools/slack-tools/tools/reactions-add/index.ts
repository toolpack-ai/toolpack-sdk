import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { resolveSlackToken } from '../../auth.js';
import { callSlackApi } from '../../common.js';

async function execute(args: Record<string, any>): Promise<string> {
  const channel = String(args.channel);
  const timestamp = String(args.timestamp);
  const reactionName = String(args.name);
  const token = resolveSlackToken(args.token as string | undefined);

  try {
    await callSlackApi('reactions.add', token, {
      channel,
      timestamp,
      name: reactionName,
    });
  } catch (err: unknown) {
    // already_reacted is not an error — the reaction is already there
    if (err instanceof Error && err.message.includes('already_reacted')) {
      return `Reaction :${reactionName}: already present on message ts=${timestamp}.`;
    }
    throw err;
  }

  return `Reaction :${reactionName}: added to message ts=${timestamp} in channel=${channel}.`;
}

export const slackReactionsAddTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
