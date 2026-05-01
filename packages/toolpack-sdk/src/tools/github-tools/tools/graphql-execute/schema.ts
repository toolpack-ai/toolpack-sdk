import { ToolParameters } from '../../../types.js';

export const name = 'github.graphql.execute';
export const displayName = 'GitHub GraphQL';
export const description = [
  'Execute a GitHub GraphQL query or mutation with standard headers.',
  'NOTE: GitHub App installation tokens (ghs_*) cannot call certain write mutations.',
  'The following mutations require a PAT and will return FORBIDDEN with an App token:',
  'resolveReviewThread, unresolveReviewThread.',
  'If using an App token, avoid these mutations and use fallback strategies (replies, new comments).',
].join(' ');
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'GraphQL query string' },
    variables: { type: 'object', description: 'Optional GraphQL variables' },
    repo: { type: 'string', description: 'owner/name — used for token resolution when no explicit token is provided' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT). Optional — omit to auto-resolve from server credentials.' },
  },
  required: ['query'],
};
