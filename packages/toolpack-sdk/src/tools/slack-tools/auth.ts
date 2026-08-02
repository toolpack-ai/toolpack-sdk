/**
 * Slack token resolution for toolpack slack-tools.
 *
 * Resolution order (first match wins):
 *   1. Explicit token passed by the caller (args.token)
 *   2. TOOLPACK_SLACK_BOT_TOKEN environment variable
 */

export function resolveSlackToken(explicitToken?: string, credentials?: import('../types.js').ToolpackCredentials): string {
  if (explicitToken) return explicitToken;

  const token = credentials?.slackBotToken ?? process.env.TOOLPACK_SLACK_BOT_TOKEN;
  if (token) return token;

  throw new Error(
    'No Slack token available. Set TOOLPACK_SLACK_BOT_TOKEN or pass token in tool args.',
  );
}
