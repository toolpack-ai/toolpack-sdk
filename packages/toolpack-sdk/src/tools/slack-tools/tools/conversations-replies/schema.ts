import { ToolParameters } from '../../../types.js';

export const name = 'slack.conversations.replies';
export const displayName = 'Get Slack Thread Replies';
export const description =
  'Fetch all replies in a Slack thread. Use this to read the full conversation history of a thread, including who replied and when. Requires the channel ID and the timestamp (ts) of the parent message that started the thread.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Channel ID that contains the thread.',
    },
    ts: {
      type: 'string',
      description: 'Timestamp of the parent message that started the thread.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of replies to return. Defaults to 20, max 100.',
    },
    oldest: {
      type: 'string',
      description: 'Only return replies after this Unix timestamp (inclusive).',
    },
    latest: {
      type: 'string',
      description: 'Only return replies before this Unix timestamp (exclusive).',
    },
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: ['channel', 'ts'],
};
