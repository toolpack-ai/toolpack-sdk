import { ToolParameters } from '../../../types.js';

export const name = 'slack.chat.postEphemeral';
export const displayName = 'Post Ephemeral Slack Message';
export const description =
  'Post a temporary message visible only to a specific user in a Slack channel. Useful for private confirmations, status updates, or error messages that should not be seen by others.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Channel ID where the ephemeral message will appear.',
    },
    user: {
      type: 'string',
      description: 'Slack user ID of the person who will see the message.',
    },
    text: {
      type: 'string',
      description: 'Message text in Slack mrkdwn format.',
    },
    thread_ts: {
      type: 'string',
      description: 'Timestamp of the parent message to show the ephemeral reply inside a thread.',
    },
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: ['channel', 'user', 'text'],
};
