import { ToolParameters } from '../../../types.js';

export const name = 'slack.chat.postMessage';
export const displayName = 'Post Slack Message';
export const description =
  'Post a message to a Slack channel or thread. Supports plain mrkdwn text and optional Block Kit blocks for rich formatting. Use thread_ts to reply inside an existing thread.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Channel ID or channel name (e.g. #general) to post to.',
    },
    text: {
      type: 'string',
      description:
        'Message text in Slack mrkdwn format. Always required — used as fallback when blocks are provided.',
    },
    thread_ts: {
      type: 'string',
      description:
        'Timestamp of the parent message to reply in a thread. Omit to post at top level.',
    },
    blocks: {
      type: 'string',
      description:
        'Optional Block Kit layout as a JSON string. When provided, text is used only as the notification fallback.',
    },
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: ['channel', 'text'],
};
