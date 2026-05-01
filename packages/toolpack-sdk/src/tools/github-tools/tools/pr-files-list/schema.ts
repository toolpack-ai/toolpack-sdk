import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.files.list';
export const displayName = 'List PR Files';
export const description = 'List files changed in a PR with positions metadata.';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'PR number' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
    perPage: { type: 'integer', description: 'Results per page (max 100)' },
    page: { type: 'integer', description: 'Page number' },
  },
  required: ['repo', 'number'],
};
