import { ToolParameters } from '../../../types.js';

export const name = 'slack.reactions.add';
export const displayName = 'Add Slack Reaction';
export const description =
  'Add an emoji reaction to a Slack message. Useful for acknowledging receipt (👀 eyes), signalling completion (✅ white_check_mark), or flagging issues (⚠️ warning). Requires the reactions:write OAuth scope on the Slack app.';
export const category = 'slack';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Channel ID containing the message to react to.',
    },
    timestamp: {
      type: 'string',
      description: 'Timestamp of the message to react to.',
    },
    name: {
      type: 'string',
      description:
        'Emoji name without colons (e.g. "eyes", "white_check_mark", "warning", "x").',
    },
    token: {
      type: 'string',
      description: 'Slack bot token. Defaults to TOOLPACK_SLACK_BOT_TOKEN env var.',
    },
  },
  required: ['channel', 'timestamp', 'name'],
};
