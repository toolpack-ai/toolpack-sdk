import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { buildHeaders } from '../../common.js';
import { logDebug } from '../../../../providers/provider-logger.js';
import { resolveGithubToken } from '../../auth.js';

async function execute(args: Record<string, any>): Promise<string> {
  const [owner, repoName] = String(args.repo).split('/');
  const number = Number(args.number);
  const token = await resolveGithubToken(args.repo as string, args.token as string | undefined);
  const unresolvedOnly = Boolean(args.unresolvedOnly);
  const first = args.first ? Number(args.first) : 100;
  const after = args.after ? String(args.after) : undefined;
  const commentsFirst = args.commentsFirst ? Number(args.commentsFirst) : 20;
  const includeMeta = Boolean(args.includeMeta);
  logDebug(`[github.pr.reviewThreads.list] repo=${owner}/${repoName} pr=${number} unresolvedOnly=${unresolvedOnly} first=${first} after=${after ?? ''} commentsFirst=${commentsFirst} includeMeta=${includeMeta}`);
  const query = `query($owner:String!,$name:String!,$number:Int!,$first:Int!,$after:String,$commentsFirst:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$number){
        headRefOid
        reviewThreads(first:$first, after:$after){
          pageInfo{ hasNextPage endCursor }
          nodes{ id isResolved isOutdated comments(first:$commentsFirst){ nodes{ databaseId body author{login} path } } }
        }
      }
    }
  }`;
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, variables: { owner, name: repoName, number, first, after, commentsFirst } }),
  });
  const raw = await resp.text();
  if (!resp.ok) return `HTTP ${resp.status} ${resp.statusText}\n${raw}`;
  try {
    const json = JSON.parse(raw) as any;
    if (json && Array.isArray(json.errors) && json.errors.length > 0) {
      logDebug(`[github.pr.reviewThreads.list] errors=${json.errors.length}`);
    }
    const pr = json?.data?.repository?.pullRequest;
    const pageInfo = pr?.reviewThreads?.pageInfo ?? { hasNextPage: false, endCursor: null };
    let nodes = pr?.reviewThreads?.nodes ?? [];
    if (unresolvedOnly) nodes = nodes.filter((n: any) => n?.isResolved === false);
    if (includeMeta) {
      const result = { headRefOid: pr?.headRefOid, threads: nodes, pageInfo };
      return `HTTP 200 OK\n${JSON.stringify(result)}`;
    }
    return `HTTP 200 OK\n${JSON.stringify(nodes)}`;
  } catch {
    return `HTTP ${resp.status} ${resp.statusText}\n${raw}`;
  }
}

export const githubPrReviewThreadsListTool: ToolDefinition = {
  name,
  displayName,
  description,
  parameters,
  category,
  execute,
};
