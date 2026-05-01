import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const repo = String(args.repo);
  const number = Number(args.number);
  const body = String(args.body);
  const token = await resolveGithubToken(repo, args.token as string | undefined);
  const url = `https://api.github.com/repos/${repo}/issues/${number}/comments`;
  logDebug(`[github.issues.comments.create] repo=${repo} number=${number}`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body }),
  });
  const text = await resp.text();
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubIssuesCommentsCreateTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
