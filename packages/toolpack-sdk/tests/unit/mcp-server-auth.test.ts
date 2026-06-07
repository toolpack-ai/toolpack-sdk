import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// ─── jose mock ────────────────────────────────────────────────────────────────
// We mock jose so JwtVerifier tests never make real network requests.

vi.mock('jose', () => ({
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
    jwtVerify: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(authHeader?: string): IncomingMessage & { auth?: AuthInfo } {
    return {
        headers: authHeader ? { authorization: authHeader } : {},
    } as unknown as IncomingMessage & { auth?: AuthInfo };
}

function makeRes() {
    const written: { statusCode: number; headers: Record<string, string>; body: string } = {
        statusCode: 200,
        headers: {},
        body: '',
    };
    const res = {
        writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
            written.statusCode = code;
            if (headers) Object.assign(written.headers, headers);
            return res;
        }),
        end: vi.fn((body?: string) => {
            written.body = body ?? '';
            return res;
        }),
        get headersSent() { return written.statusCode !== 200 || written.body !== ''; },
        _written: written,
    };
    return res as unknown as ServerResponse & { _written: typeof written };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildVerifier', () => {
    it('returns a verifier for each mode without throwing', async () => {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        expect(buildVerifier({ mode: 'static', tokens: ['tok'] })).toBeDefined();
        expect(buildVerifier({ mode: 'jwt', jwksUrl: 'https://example.com/.well-known/jwks.json' })).toBeDefined();
        expect(buildVerifier({ mode: 'custom', verifyAccessToken: async () => ({ token: 't', clientId: 'c', scopes: [] }) })).toBeDefined();
    });
});

describe('StaticBearerVerifier', () => {
    beforeEach(() => vi.resetModules());

    it('resolves with AuthInfo for a valid token', async () => {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        const verifier = buildVerifier({ mode: 'static', tokens: ['secret-token', 'other-token'] });
        const info = await verifier.verifyAccessToken('secret-token');
        expect(info.token).toBe('secret-token');
        expect(info.clientId).toBe('static-client');
        expect(info.scopes).toEqual([]);
    });

    it('throws for an invalid token', async () => {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        const verifier = buildVerifier({ mode: 'static', tokens: ['correct'] });
        await expect(verifier.verifyAccessToken('wrong')).rejects.toThrow();
    });

    it('throws at construction when tokens array is empty', async () => {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        expect(() => buildVerifier({ mode: 'static', tokens: [] })).toThrow(/empty/i);
    });

    it('accepts any token from the allowlist', async () => {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        const verifier = buildVerifier({ mode: 'static', tokens: ['a', 'b', 'c'] });
        await expect(verifier.verifyAccessToken('a')).resolves.toBeDefined();
        await expect(verifier.verifyAccessToken('b')).resolves.toBeDefined();
        await expect(verifier.verifyAccessToken('c')).resolves.toBeDefined();
    });
});

describe('JwtVerifier', () => {
    beforeEach(() => vi.resetModules());

    async function getJwtVerifier(config = {}) {
        const { buildVerifier } = await import('../../src/mcp/server-auth.js');
        return buildVerifier({ mode: 'jwt', jwksUrl: 'https://example.com/.well-known/jwks.json', ...config });
    }

    it('resolves with AuthInfo for a valid JWT — scope string', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockResolvedValueOnce({
            payload: { sub: 'user-123', scope: 'read write', exp: 9999999999 },
            protectedHeader: { alg: 'RS256' },
        } as never);
        const verifier = await getJwtVerifier();
        const info = await verifier.verifyAccessToken('jwt-token');
        expect(info.clientId).toBe('user-123');
        expect(info.scopes).toEqual(['read', 'write']);
        expect(info.expiresAt).toBe(9999999999);
    });

    it('handles scp array claim (Okta / Azure AD)', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockResolvedValueOnce({
            payload: { sub: 'user-456', scp: ['api:read', 'api:write'] },
            protectedHeader: { alg: 'RS256' },
        } as never);
        const verifier = await getJwtVerifier();
        const info = await verifier.verifyAccessToken('jwt-token');
        expect(info.scopes).toEqual(['api:read', 'api:write']);
    });

    it('prefers client_id claim over sub for clientId', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockResolvedValueOnce({
            payload: { sub: 'user-123', client_id: 'my-app', scope: '' },
            protectedHeader: { alg: 'RS256' },
        } as never);
        const verifier = await getJwtVerifier();
        const info = await verifier.verifyAccessToken('jwt-token');
        expect(info.clientId).toBe('my-app');
    });

    it('falls back to "unknown" clientId when neither client_id nor sub present', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockResolvedValueOnce({
            payload: { scope: '' },
            protectedHeader: { alg: 'RS256' },
        } as never);
        const verifier = await getJwtVerifier();
        const info = await verifier.verifyAccessToken('jwt-token');
        expect(info.clientId).toBe('unknown');
    });

    it('propagates errors from jwtVerify (expired, invalid signature, etc.)', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockRejectedValueOnce(new Error('JWTExpired'));
        const verifier = await getJwtVerifier();
        await expect(verifier.verifyAccessToken('expired-jwt')).rejects.toThrow('JWTExpired');
    });

    it('returns empty scopes when no scope claim present', async () => {
        const { jwtVerify } = await import('jose');
        vi.mocked(jwtVerify).mockResolvedValueOnce({
            payload: { sub: 'u', client_id: 'c' },
            protectedHeader: { alg: 'RS256' },
        } as never);
        const verifier = await getJwtVerifier();
        const info = await verifier.verifyAccessToken('jwt');
        expect(info.scopes).toEqual([]);
    });
});

describe('applyBearerAuth', () => {
    beforeEach(() => vi.resetModules());

    const mockVerifier = (result: 'ok' | 'throw') => ({
        verifyAccessToken: result === 'ok'
            ? vi.fn().mockResolvedValue({ token: 'tok', clientId: 'c', scopes: ['read'] })
            : vi.fn().mockRejectedValue(new Error('bad token')),
    });

    it('returns false and writes 401 when Authorization header is missing', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq();
        const res = makeRes();
        const ok = await applyBearerAuth(req, res as unknown as ServerResponse, { mode: 'static', tokens: ['t'] }, mockVerifier('ok'));
        expect(ok).toBe(false);
        expect(res._written.statusCode).toBe(401);
        expect(res._written.headers['WWW-Authenticate']).toBe('Bearer');
    });

    it('returns false and writes 401 when Authorization header is not Bearer', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Basic dXNlcjpwYXNz');
        const res = makeRes();
        const ok = await applyBearerAuth(req, res as unknown as ServerResponse, { mode: 'static', tokens: ['t'] }, mockVerifier('ok'));
        expect(ok).toBe(false);
        expect(res._written.statusCode).toBe(401);
    });

    it('returns false and writes 401 when verifier throws', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Bearer invalid-token');
        const res = makeRes();
        const ok = await applyBearerAuth(req, res as unknown as ServerResponse, { mode: 'static', tokens: ['correct'] }, mockVerifier('throw'));
        expect(ok).toBe(false);
        expect(res._written.statusCode).toBe(401);
    });

    it('returns true and sets req.auth when token is valid', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Bearer valid-token');
        const res = makeRes();
        const ok = await applyBearerAuth(req, res as unknown as ServerResponse, { mode: 'static', tokens: ['valid-token'] }, mockVerifier('ok'));
        expect(ok).toBe(true);
        expect(req.auth).toBeDefined();
        expect(req.auth?.clientId).toBe('c');
    });

    it('returns false and writes 403 when required scope is missing', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Bearer tok');
        const res = makeRes();
        // verifier returns scopes: ['read'], but we require 'write'
        // Use mode: 'custom' — it properly declares requiredScopes in its type
        const ok = await applyBearerAuth(
            req,
            res as unknown as ServerResponse,
            { mode: 'custom', verifyAccessToken: async () => ({ token: 'tok', clientId: 'c', scopes: ['read'] }), requiredScopes: ['write'] },
            mockVerifier('ok'),
        );
        expect(ok).toBe(false);
        expect(res._written.statusCode).toBe(403);
        expect(res._written.body).toContain('write');
    });

    it('passes when token has all required scopes', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Bearer tok');
        const res = makeRes();
        // verifier returns scopes: ['read'], requiring only 'read'
        const ok = await applyBearerAuth(
            req,
            res as unknown as ServerResponse,
            { mode: 'custom', verifyAccessToken: async () => ({ token: 'tok', clientId: 'c', scopes: ['read'] }), requiredScopes: ['read'] },
            mockVerifier('ok'),
        );
        expect(ok).toBe(true);
    });

    it('passes when requiredScopes is empty', async () => {
        const { applyBearerAuth } = await import('../../src/mcp/server-auth.js');
        const req = makeReq('Bearer tok');
        const res = makeRes();
        const ok = await applyBearerAuth(
            req,
            res as unknown as ServerResponse,
            { mode: 'custom', verifyAccessToken: async () => ({ token: 'tok', clientId: 'c', scopes: [] }), requiredScopes: [] },
            mockVerifier('ok'),
        );
        expect(ok).toBe(true);
    });
});
