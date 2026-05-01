import { ToolParameters } from '../../../types.js';

export const name = 'github.pr.reviewThreads.list';
export const displayName = 'List PR Review Threads';
export const description = 'List PR review threads via GraphQL (optionally unresolved only).';
export const category = 'github';

export const parameters: ToolParameters = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    number: { type: 'integer', description: 'PR number' },
    token: { type: 'string', description: 'GitHub token (App installation or PAT)' },
    unresolvedOnly: { type: 'boolean', description: 'If true, filter unresolved threads only' },
    first: { type: 'integer', description: 'Threads page size (max 100). Default 100.' },
    after: { type: 'string', description: 'Cursor for pagination (GraphQL pageInfo.endCursor).' },
    commentsFirst: { type: 'integer', description: 'Comments per thread (max 100). Default 20.' },
    includeMeta: { type: 'boolean', description: 'If true, return { headRefOid, threads, pageInfo } instead of array.' },
  },
  required: ['repo', 'number'],
};
