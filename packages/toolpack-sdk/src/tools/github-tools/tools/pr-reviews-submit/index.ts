import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const repo = String(args.repo);
  const number = Number(args.number);
  const event = String(args.event);
  const body = args.body ? String(args.body) : undefined;
  const comments = Array.isArray(args.comments) ? args.comments : undefined;
  const token = await resolveGithubToken(repo, args.token as string | undefined);

  const url = `https://api.github.com/repos/${repo}/pulls/${number}/reviews`;
  logDebug(`[github.pr.reviews.submit] repo=${repo} pr=${number} event=${event} comments=${comments?.length ?? 0}`);

  const payload: any = { event };
  if (body) payload.body = body;
  if (comments && comments.length > 0) payload.comments = comments;

  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubPrReviewsSubmitTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
