/**
 * GitHub token resolution for toolpack github-tools.
 *
 * Resolution order (first match wins):
 *   1. Explicit token passed by the caller (args.token)
 *   2. GITHUB_PAT environment variable
 *   3. GitHub App installation token — minted from GITHUB_APP_ID +
 *      GITHUB_APP_PRIVATE_KEY; installationId is looked up via the
 *      repo name when not supplied directly.
 *
 * Tokens are cached by installationId (50-minute TTL; GitHub tokens last 60).
 */

import * as crypto from 'crypto';

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<number, CachedToken>();
const installationIdCache = new Map<string, number>(); // repo → installationId

/**
 * Resolve a GitHub API token from multiple sources.
 *
 * @param repo - "owner/name" used only for App installation lookup.
 * @param explicitToken - Token passed directly in tool args (highest priority).
 */
export async function resolveGithubToken(
  repo?: string,
  explicitToken?: string,
): Promise<string> {
  if (explicitToken) return explicitToken;

  const pat = process.env.GITHUB_PAT;
  if (pat) return pat;

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !privateKey) {
    throw new Error(
      'No GitHub token available. Set GITHUB_PAT, or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY.',
    );
  }

  const installationId = await lookupInstallationId(appId, privateKey, repo);
  return mintInstallationToken(appId, privateKey, installationId);
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function lookupInstallationId(
  appId: string,
  privateKey: string,
  repo: string | undefined,
): Promise<number> {
  if (!repo) {
    throw new Error(
      'Cannot resolve GitHub App installation token without a repo name. Pass args.repo or set GITHUB_PAT.',
    );
  }

  const cached = installationIdCache.get(repo);
  if (cached !== undefined) return cached;

  const jwt = signAppJwt(appId, privateKey);
  const res = await fetch(`https://api.github.com/repos/${repo}/installation`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to look up installation for ${repo} (${res.status}): ${body}`,
    );
  }

  const data = (await res.json()) as { id: number };
  installationIdCache.set(repo, data.id);
  return data.id;
}

async function mintInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = signAppJwt(appId, privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to mint installation token (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });
  return data.token;
}

function signAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: appId };

  const enc = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const data = `${enc(header)}.${enc(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  return (
    `${data}.` +
    signer
      .sign(privateKey)
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  );
}
