import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.reviewThreads.resolve';
export const displayName = 'Resolve Review Thread';
export const description = [
  'Resolve a PR review thread via GraphQL resolveReviewThread mutation.',
  'IMPORTANT: GitHub App installation tokens (ghs_*) cannot call this mutation — GitHub returns FORBIDDEN.',
  'This tool only works with a Personal Access Token (PAT) that has repo scope.',
  'If you are using a GitHub App installation token, do NOT call this tool.',
  'Instead, post a reply on the thread acknowledging the fix and ask the author to resolve it manually.',
].join(' ');
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    threadId: { type: 'string', description: 'GraphQL node ID of the review thread' },
    repo: { type: 'string', description: 'owner/name — used for token resolution when no explicit token is provided' },
    token: { type: 'string', description: 'GitHub token — MUST be a PAT with repo scope. App installation tokens (ghs_*) will receive FORBIDDEN.' },
  },
  required: ['threadId'],
};
