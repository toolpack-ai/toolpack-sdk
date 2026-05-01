import { ToolParameters } from '../../../types.js';

export const name = 'github.issues.comments.create';
export const displayName = 'Create Issue/PR Comment';
export const description = 'Create a comment on an issue or pull request (conversation tab).';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'Issue or PR number' },
    body: { type: 'string', description: 'Comment body' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
  },
  required: ['repo', 'number', 'body'],
};
