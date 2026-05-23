/**
 * Slack token resolution for toolpack slack-tools.
 *
 * Resolution order (first match wins):
 *   1. Explicit token passed by the caller (args.token)
 *   2. TOOLPACK_SLACK_BOT_TOKEN environment variable
 */

export function resolveSlackToken(explicitToken?: string): string {
  if (explicitToken) return explicitToken;

  const env = process.env.TOOLPACK_SLACK_BOT_TOKEN;
  if (env) return env;

  throw new Error(
    'No Slack token available. Set TOOLPACK_SLACK_BOT_TOKEN or pass token in tool args.',
  );
}
