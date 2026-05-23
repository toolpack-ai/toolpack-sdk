import { ToolProject } from '../types.js';
import { slackChatPostMessageTool } from './tools/chat-post-message/index.js';
import { slackChatPostEphemeralTool } from './tools/chat-post-ephemeral/index.js';
import { slackReactionsAddTool } from './tools/reactions-add/index.js';
import { slackConversationsHistoryTool } from './tools/conversations-history/index.js';
import { slackConversationsRepliesTool } from './tools/conversations-replies/index.js';
import { slackAuthTestTool } from './tools/auth-test/index.js';

export { slackChatPostMessageTool } from './tools/chat-post-message/index.js';
export { slackChatPostEphemeralTool } from './tools/chat-post-ephemeral/index.js';
export { slackReactionsAddTool } from './tools/reactions-add/index.js';
export { slackConversationsHistoryTool } from './tools/conversations-history/index.js';
export { slackConversationsRepliesTool } from './tools/conversations-replies/index.js';
export { slackAuthTestTool } from './tools/auth-test/index.js';

export const slackToolsProject: ToolProject = {
  manifest: {
    key: 'slack',
    name: 'slack-tools',
    displayName: 'Slack',
    version: '1.0.0',
    description: 'Slack Web API tools — post messages, reply in threads, react to messages, read channel history, read thread replies, and verify bot identity.',
    author: 'Toolpack',
    tools: [
      'slack.chat.postMessage',
      'slack.chat.postEphemeral',
      'slack.reactions.add',
      'slack.conversations.history',
      'slack.conversations.replies',
      'slack.auth.test',
    ],
    category: 'network',
  },
  tools: [
    slackChatPostMessageTool,
    slackChatPostEphemeralTool,
    slackReactionsAddTool,
    slackConversationsHistoryTool,
    slackConversationsRepliesTool,
    slackAuthTestTool,
  ],
};
