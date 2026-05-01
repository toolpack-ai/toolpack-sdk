import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.reviews.submit';
export const displayName = 'Submit PR Review';
export const description = 'Submit a PR review (APPROVE, REQUEST_CHANGES, or COMMENT), optionally with inline comments.';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'PR number' },
    event: { type: 'string', description: 'Review event', enum: ['APPROVE','REQUEST_CHANGES','COMMENT'] },
    body: { type: 'string', description: 'Top-level review body', },
    comments: { type: 'array', description: 'Optional inline comments array', items: {
      type: 'object', properties: {
        path: { type: 'string', description: 'File path' },
        position: { type: 'integer', description: 'Position in the diff' },
        body: { type: 'string', description: 'Comment body' },
      }, required: ['path','position','body']
    }},
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
  },
  required: ['repo', 'number', 'event'],
};
