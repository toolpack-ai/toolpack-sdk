export function buildHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(extra || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
