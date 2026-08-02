import { ToolDefinition, ToolContext } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { resolveSlackToken } from '../../auth.js';
import { callSlackApi } from '../../common.js';

async function execute(args: Record<string, any>, ctx?: ToolContext): Promise<string> {
  const token = resolveSlackToken(args.token as string | undefined, ctx?.config?.credentials);

  const data = await callSlackApi('auth.test', token, {});

  return JSON.stringify({
    bot_id: data.bot_id,
    user_id: data.user_id,
    user: data.user,
    team: data.team,
    team_id: data.team_id,
    url: data.url,
  }, null, 2);
}

export const slackAuthTestTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
