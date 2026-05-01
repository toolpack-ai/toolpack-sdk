import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.reviewComments.reply';
export const displayName = 'Reply to Review Comment';
export const description = 'Reply within an existing PR review thread to maintain continuity.';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'PR number' },
    inReplyTo: { type: 'integer', description: 'databaseId of the review comment to reply to' },
    body: { type: 'string', description: 'Reply body' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
  },
  required: ['repo', 'number', 'inReplyTo', 'body'],
};
