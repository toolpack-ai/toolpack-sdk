import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { buildHeaders } from '../../common.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const query = args.query as string;
  const variables = (args.variables ?? {}) as Record<string, any>;
  const token = await resolveGithubToken(args.repo as string | undefined, args.token as string | undefined);
  logDebug(`[github.graphql.execute] query_len=${query?.length ?? 0}`);

  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  try {
    const json = JSON.parse(text) as any;
    if (json && Array.isArray(json.errors) && json.errors.length > 0) {
      logDebug(`[github.graphql.execute] errors=${json.errors.length}`);
    }
  } catch {
    // non-JSON body; ignore
  }
  return `HTTP ${resp.status} ${resp.statusText}\n${text}`;
}

export const githubGraphqlExecuteTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
