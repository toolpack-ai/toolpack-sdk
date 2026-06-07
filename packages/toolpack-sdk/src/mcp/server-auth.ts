import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { McpAuthConfig } from './server-types.js';

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Build an OAuthTokenVerifier from the given auth config.
 * The returned verifier is stateful (JwtVerifier caches the JWKS) —
 * create once per server lifetime, not once per request.
 */
export function buildVerifier(auth: McpAuthConfig): OAuthTokenVerifier {
    switch (auth.mode) {
        case 'static': return new StaticBearerVerifier(auth.tokens);
        case 'jwt':    return new JwtVerifier(auth);
        case 'custom': return { verifyAccessToken: auth.verifyAccessToken };
    }
}

/**
 * Extract and verify a bearer token from an incoming HTTP request.
 *
 * On success: attaches AuthInfo to req.auth and returns true.
 * On failure: writes a 401 or 403 response and returns false.
 *             The caller must stop processing the request when false is returned.
 */
export async function applyBearerAuth(
    req: IncomingMessage & { auth?: AuthInfo },
    res: ServerResponse,
    auth: McpAuthConfig,
    verifier: OAuthTokenVerifier,
): Promise<boolean> {
    const authHeader = req.headers['authorization'];
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
        return false;
    }

    let authInfo: AuthInfo;
    try {
        authInfo = await verifier.verifyAccessToken(token);
    } catch {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
        return false;
    }

    // Scope enforcement — only when requiredScopes is explicitly provided.
    const required = 'requiredScopes' in auth ? auth.requiredScopes : undefined;
    if (required?.length) {
        const granted = new Set(authInfo.scopes);
        const missing = required.filter(s => !granted.has(s));
        if (missing.length > 0) {
            res.writeHead(403).end(`Missing required scopes: ${missing.join(', ')}`);
            return false;
        }
    }

    req.auth = authInfo;
    return true;
}

// ─── StaticBearerVerifier ─────────────────────────────────────────────────────

class StaticBearerVerifier implements OAuthTokenVerifier {
    // Set for O(1) lookup. Timing is not perfectly constant across the Set.has()
    // call, but acceptable for static tokens — they are opaque random strings,
    // not secrets where a timing-safe compare is strictly required.
    private readonly tokenSet: Set<string>;

    constructor(tokens: string[]) {
        if (tokens.length === 0) {
            throw new Error(
                'McpAuthConfig static mode: tokens array must not be empty. ' +
                'Generate a token with: crypto.randomBytes(32).toString("hex")',
            );
        }
        this.tokenSet = new Set(tokens);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        if (!this.tokenSet.has(token)) {
            throw new Error('Invalid bearer token.');
        }
        return { token, clientId: 'static-client', scopes: [] };
    }
}

// ─── JwtVerifier ──────────────────────────────────────────────────────────────

class JwtVerifier implements OAuthTokenVerifier {
    // createRemoteJWKSet returns a cached, auto-rotating key set.
    // One instance per server lifetime is the correct usage.
    private readonly JWKS: ReturnType<typeof createRemoteJWKSet>;
    private readonly audience?: string;
    private readonly issuer?: string;

    constructor(config: { jwksUrl: string; audience?: string; issuer?: string }) {
        this.JWKS = createRemoteJWKSet(new URL(config.jwksUrl));
        this.audience = config.audience;
        this.issuer = config.issuer;
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const { payload } = await jwtVerify(token, this.JWKS, {
            audience: this.audience,
            issuer: this.issuer,
        });

        // Scope extraction:
        // - RFC 9068: `scope` claim — space-separated string
        // - Okta / Azure AD: `scp` claim — array of strings
        const scopeRaw = payload['scope'] ?? payload['scp'];
        const scopes: string[] = Array.isArray(scopeRaw)
            ? scopeRaw.filter((s): s is string => typeof s === 'string')
            : typeof scopeRaw === 'string'
                ? scopeRaw.split(' ').filter(Boolean)
                : [];

        // clientId: prefer explicit `client_id` claim, fall back to `sub`
        const clientId = typeof payload['client_id'] === 'string'
            ? payload['client_id']
            : typeof payload.sub === 'string'
                ? payload.sub
                : 'unknown';

        return { token, clientId, scopes, expiresAt: payload.exp };
    }
}
