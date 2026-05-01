import { ToolProject } from '../types.js';
import { githubGraphqlExecuteTool } from './tools/graphql-execute/index.js';
import { githubContentsGetTextTool } from './tools/contents-get-text/index.js';
import { githubPrReviewThreadsListTool } from './tools/pr-review-threads-list/index.js';
import { githubPrReviewThreadsResolveTool } from './tools/pr-review-threads-resolve/index.js';
import { githubPrReviewCommentsReplyTool } from './tools/pr-review-comments-reply/index.js';
import { githubPrDiffGetTool } from './tools/pr-diff-get/index.js';
import { githubPrFilesListTool } from './tools/pr-files-list/index.js';
import { githubPrReviewsSubmitTool } from './tools/pr-reviews-submit/index.js';
import { githubIssuesCommentsCreateTool } from './tools/issues-comments-create/index.js';
export { githubGraphqlExecuteTool } from './tools/graphql-execute/index.js';
export { githubContentsGetTextTool } from './tools/contents-get-text/index.js';
export { githubPrReviewThreadsListTool } from './tools/pr-review-threads-list/index.js';
export { githubPrReviewThreadsResolveTool } from './tools/pr-review-threads-resolve/index.js';
export { githubPrReviewCommentsReplyTool } from './tools/pr-review-comments-reply/index.js';
export { githubPrDiffGetTool } from './tools/pr-diff-get/index.js';
export { githubPrFilesListTool } from './tools/pr-files-list/index.js';
export { githubPrReviewsSubmitTool } from './tools/pr-reviews-submit/index.js';
export { githubIssuesCommentsCreateTool } from './tools/issues-comments-create/index.js';

export const githubToolsProject: ToolProject = {
  manifest: {
    key: 'github',
    name: 'github-tools',
    displayName: 'GitHub',
    version: '1.0.0',
    description: 'GitHub GraphQL/REST tools for PR threads, comments, and contents.',
    author: 'Toolpack',
    tools: [
      'github.graphql.execute',
      'github.contents.getText',
      'github.pr.reviewThreads.list',
      'github.pr.reviewThreads.resolve',
      'github.pr.reviewComments.reply',
      'github.pr.diff.get',
      'github.pr.files.list',
      'github.pr.reviews.submit',
      'github.issues.comments.create',
    ],
    category: 'network',
  },
  tools: [
    githubGraphqlExecuteTool,
    githubContentsGetTextTool,
    githubPrReviewThreadsListTool,
    githubPrReviewThreadsResolveTool,
    githubPrReviewCommentsReplyTool,
    githubPrDiffGetTool,
    githubPrFilesListTool,
    githubPrReviewsSubmitTool,
    githubIssuesCommentsCreateTool,
  ],
  dependencies: {},
};
