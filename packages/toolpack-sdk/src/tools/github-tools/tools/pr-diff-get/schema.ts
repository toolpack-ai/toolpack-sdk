import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.diff.get';
export const displayName = 'Get PR Diff';
export const description = 'Fetch the unified diff for a pull request (text/patch).';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'PR number' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
    maxBytes: { type: 'integer', description: 'Optional max bytes of diff to return; if exceeded, result is truncated with a footer.' },
  },
  required: ['repo', 'number'],
};
