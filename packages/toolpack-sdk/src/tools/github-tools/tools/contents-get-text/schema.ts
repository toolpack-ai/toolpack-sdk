import { ToolParameters } from '../../../types.js';

export const name = 'github.contents.getText';
export const displayName = 'Get Repo File (Text)';
export const description = 'Fetch file content (decoded text) via the GitHub Contents API.';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name (e.g. octo/repo)' },
    path: { type: 'string', description: 'File path within the repo' },
    ref: { type: 'string', description: 'Branch, tag, or commit sha' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
    maxBytes: { type: 'integer', description: 'Optional max bytes of decoded text to return; if exceeded, result is truncated with a footer.' },
  },
  required: ['repo', 'path'],
};
