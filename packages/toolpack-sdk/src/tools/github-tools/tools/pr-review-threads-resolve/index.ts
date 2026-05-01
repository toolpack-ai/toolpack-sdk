import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const id = String(args.threadId);
  const token = await resolveGithubToken(args.repo as string | undefined, args.token as string | undefined);
  logDebug(`[github.pr.reviewThreads.resolve] threadId=${id}`);
  const mutation = 'mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}) { thread { id isResolved } } }';
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query: mutation, variables: { id } }),
  });
  const text = await resp.text();
  // GitHub App installation tokens (ghs_*) cannot resolve review threads —
  // the resolveReviewThread mutation requires a user identity (PAT or user OAuth token).
  // Detect this and return an actionable message so the AI can gracefully fall back.
  if (resp.ok) {
    try {
      const json = JSON.parse(text) as { errors?: Array<{ type?: string; message?: string }> };
      const forbidden = json.errors?.find((e) => e.type === 'FORBIDDEN');
      if (forbidden) {
        return [
          'TOOL_UNSUPPORTED_FOR_TOKEN_TYPE: resolveReviewThread is not available for GitHub App installation tokens (ghs_*).',
          'GitHub requires a user identity (PAT with repo scope) for this operation.',
          'Fallback action: post a reply on the thread acknowledging the fix and ask the author to resolve it manually.',
        ].join(' ');
      }
    } catch { /* non-JSON — fall through to raw response */ }
  }
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubPrReviewThreadsResolveTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
