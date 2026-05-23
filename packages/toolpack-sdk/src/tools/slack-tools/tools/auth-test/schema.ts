import { ToolParameters } from '../../../types.js';

export const name = 'slack.auth.test';
export const displayName = 'Slack Auth Test';
export const description =
  'Verify the bot token and retrieve the identity of the calling app. Returns the bot_id, user_id, team, and workspace URL. Use this when the bot_id is not configured and is needed for self-suppression or other identity checks.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: [],
};
