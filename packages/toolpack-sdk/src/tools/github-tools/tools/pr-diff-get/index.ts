import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';
import { Buffer } from 'node:buffer';

async function execute(args: Record<string, any>): Promise<string> {
  const repo = String(args.repo);
  const number = Number(args.number);
  const token = await resolveGithubToken(repo, args.token as string | undefined);
  const maxBytes = args.maxBytes ? Number(args.maxBytes) : undefined;
  const url = `https://api.github.com/repos/${repo}/pulls/${number}`;
  logDebug(`[github.pr.diff.get] repo=${repo} pr=${number}`);
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token, { Accept: 'application/vnd.github.v3.diff' }),
  });
  const body = await resp.text();
  if (maxBytes && Buffer.byteLength(body, 'utf8') > maxBytes) {
    const slice = Buffer.from(body, 'utf8').subarray(0, maxBytes).toString('utf8');
    const footer = `\n… [truncated, ${maxBytes} of ${Buffer.byteLength(body, 'utf8')} bytes]`;
    return `HTTP ${resp.status} ${resp.statusText}\n${slice}${footer}`;
  }
  return `HTTP ${resp.status} ${resp.statusText}\n${body}`;
}

export const githubPrDiffGetTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
