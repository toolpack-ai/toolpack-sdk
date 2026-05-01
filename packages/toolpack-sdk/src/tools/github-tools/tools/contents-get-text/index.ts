import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { buildHeaders } from '../../common.js';
import { resolveGithubToken } from '../../auth.js';
import { Buffer } from 'node:buffer';

async function execute(args: Record<string, any>): Promise<string> {
  const repo = args.repo as string;
  const path = args.path as string;
  const ref = args.ref as string | undefined;
  const token = await resolveGithubToken(repo, args.token as string | undefined);
  const maxBytes = args.maxBytes ? Number(args.maxBytes) : undefined;
  const encodedPath = path.split('/').map((s) => encodeURIComponent(s)).join('/');
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  logDebug(`[github.contents.getText] repo=${repo} path=${path} ref=${ref ?? ''}`);

  const resp = await fetch(url, { method: 'GET', headers: buildHeaders(token) });
  const text = await resp.text();
  if (!resp.ok) return `HTTP ${resp.status} ${resp.statusText}\n${text}`;

  try {
    const json = JSON.parse(text) as any;
    const b64 = json?.content as string | undefined;
    if (typeof b64 === 'string') {
      const raw = Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf8');
      if (maxBytes && Buffer.byteLength(raw, 'utf8') > maxBytes) {
        const slice = Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8');
        const footer = `\n… [truncated, ${maxBytes} of ${Buffer.byteLength(raw, 'utf8')} bytes]`;
        return `HTTP ${resp.status} ${resp.statusText}\n${slice}${footer}`;
      }
      return `HTTP ${resp.status} ${resp.statusText}\n${raw}`;
    }
  } catch {
    // ignore
  }
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubContentsGetTextTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
