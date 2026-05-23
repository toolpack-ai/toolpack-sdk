import { ToolParameters } from '../../../types.js';

export const name = 'slack.conversations.history';
export const displayName = 'Get Slack Channel History';
export const description =
  'Fetch recent messages from a Slack channel. Useful for reading conversation context, checking what was discussed, or finding a specific message timestamp to react to or thread-reply into.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Channel ID to fetch history from.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of messages to return. Defaults to 10, max 100.',
    },
    oldest: {
      type: 'string',
      description: 'Only return messages after this Unix timestamp (inclusive).',
    },
    latest: {
      type: 'string',
      description: 'Only return messages before this Unix timestamp (exclusive).',
    },
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: ['channel'],
};
