import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const repo = String(args.repo);
  const number = Number(args.number);
  const token = await resolveGithubToken(repo, args.token as string | undefined);
  const perPage = args.perPage ? Number(args.perPage) : undefined;
  const page = args.page ? Number(args.page) : undefined;
  const qp = new URLSearchParams();
  if (perPage) qp.set('per_page', String(perPage));
  if (page) qp.set('page', String(page));
  const url = `https://api.github.com/repos/${repo}/pulls/${number}/files${qp.toString() ? `?${qp.toString()}` : ''}`;
  logDebug(`[github.pr.files.list] repo=${repo} pr=${number} perPage=${perPage ?? ''} page=${page ?? ''}`);
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });
  const text = await resp.text();
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubPrFilesListTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
