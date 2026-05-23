/**
 * Shared utilities for Slack tools.
 */

export function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

/**
 * Call a Slack Web API method and return the parsed response.
 * Throws if the HTTP request fails or Slack returns ok:false.
 */
export async function callSlackApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Slack HTTP error ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
  }

  return data;
}
