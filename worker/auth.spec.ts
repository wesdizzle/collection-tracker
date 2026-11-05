import { describe, it, expect, vi } from 'vitest';
import {
  signSession,
  verifySession,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  extractAccessEmail,
  normalizeHomeRegion,
  timingSafeEqualStrings,
  verifyAccessJwt,
  resetAccessJwksCache,
  SessionUser,
} from './auth.js';

describe('worker/auth', () => {
  const secret = 'super-secret-test-key-32-characters-long!';
  const user: SessionUser = {
    id: 1,
    username: 'wesley',
    role: 'admin',
    homeRegion: 'USA',
  };

  it('signs and verifies a valid session token', async () => {
    const token = await signSession(user, secret, 30);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');

    const verified = await verifySession(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(1);
    expect(verified?.username).toBe('wesley');
    expect(verified?.role).toBe('admin');
    expect(verified?.homeRegion).toBe('USA');
  });

  it('rejects tampered session tokens', async () => {
    const token = await signSession(user, secret, 30);
    const tampered = token.slice(0, -3) + 'xyz';
    const verified = await verifySession(tampered, secret);
    expect(verified).toBeNull();
  });

  it('rejects expired session tokens', async () => {
    const nowMs = Date.now();
    // Negative days = already expired
    const expiredToken = await signSession(user, secret, -1, nowMs);
    const verified = await verifySession(expiredToken, secret, nowMs);
    expect(verified).toBeNull();
  });

  it('rejects invalid or wrong secret', async () => {
    const token = await signSession(user, secret, 30);
    const verified = await verifySession(
      token,
      'different-secret-key-altogether',
    );
    expect(verified).toBeNull();
  });

  it('parses cookies from header string', () => {
    const header = 'app_user_session=abc.123; other=foo; third=bar';
    const cookies = parseCookies(header);
    expect(cookies['app_user_session']).toBe('abc.123');
    expect(cookies['other']).toBe('foo');
    expect(cookies['third']).toBe('bar');
  });

  it('builds session cookie with security flags', () => {
    const cookie = buildSessionCookie('mytoken', 3600, true);
    expect(cookie).toContain('app_user_session=mytoken');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  it('builds clearing cookie with epoch expiry', () => {
    const cookie = clearSessionCookie(false);
    expect(cookie).toContain('app_user_session=;');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Thu, 01 Jan 1970');
  });

  it('normalizes home region correctly', () => {
    expect(normalizeHomeRegion('usa')).toBe('USA');
    expect(normalizeHomeRegion('UK')).toBe('UK');
    expect(normalizeHomeRegion('japan')).toBe('Japan');
    expect(normalizeHomeRegion('InvalidRegion')).toBeNull();
  });

  it('compares strings in constant time with timingSafeEqualStrings', () => {
    expect(timingSafeEqualStrings('secret-key-123', 'secret-key-123')).toBe(
      true,
    );
    expect(timingSafeEqualStrings('secret-key-123', 'secret-key-124')).toBe(
      false,
    );
    expect(timingSafeEqualStrings('secret-key-123', 'short')).toBe(false);
    expect(timingSafeEqualStrings('', '')).toBe(false);
  });

  describe('extractAccessEmail', () => {
    it('rejects unverified direct header and unsigned cookie on non-loopback origin when teamDomain is unset', async () => {
      const headerReq = new Request('https://example.com/', {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'WESLEY@EXAMPLE.COM',
        },
      });
      expect(await extractAccessEmail(headerReq)).toBeNull();

      const headerB64 = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payloadB64 = btoa(
        JSON.stringify({
          email: 'collector@games.org',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const mockJwt = `${headerB64}.${payloadB64}.fake-sig`;
      const cookieReq = new Request('https://example.com/', {
        headers: {
          Cookie: `CF_Authorization=${mockJwt}`,
        },
      });
      expect(await extractAccessEmail(cookieReq)).toBeNull();
    });

    it('extracts email from direct header on loopback origin', async () => {
      const req = new Request('http://localhost/', {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'WESLEY@EXAMPLE.COM',
        },
      });
      const email = await extractAccessEmail(req);
      expect(email).toBe('wesley@example.com');
    });

    it('extracts email from CF_Authorization cookie payload on loopback without teamDomain', async () => {
      const headerB64 = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payloadB64 = btoa(
        JSON.stringify({
          email: 'collector@games.org',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const mockJwt = `${headerB64}.${payloadB64}.fake-sig`;
      const req = new Request('http://localhost/', {
        headers: {
          Cookie: `CF_Authorization=${mockJwt}`,
        },
      });
      const email = await extractAccessEmail(req);
      expect(email).toBe('collector@games.org');
    });

    it('rejects expired or exp-less CF_Authorization cookie on loopback', async () => {
      const headerB64 = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payloadB64 = btoa(
        JSON.stringify({
          email: 'expired@games.org',
          exp: Math.floor(Date.now() / 1000) - 100,
        }),
      );
      const mockJwt = `${headerB64}.${payloadB64}.fake-sig`;
      const req = new Request('http://localhost/', {
        headers: {
          Cookie: `CF_Authorization=${mockJwt}`,
        },
      });
      expect(await extractAccessEmail(req)).toBeNull();

      const noExpPayload = btoa(JSON.stringify({ email: 'noexp@games.org' }));
      const noExpReq = new Request('http://localhost/', {
        headers: {
          Cookie: `CF_Authorization=${headerB64}.${noExpPayload}.sig`,
        },
      });
      expect(await extractAccessEmail(noExpReq)).toBeNull();
    });

    it('extracts email from ctx.access.getIdentity() when present', async () => {
      const req = new Request('https://example.com/');
      const mockCtx = {
        access: {
          getIdentity: vi.fn().mockResolvedValue({
            email: 'CTX_USER@EXAMPLE.COM',
          }),
        },
      };
      const email = await extractAccessEmail(req, { ctx: mockCtx });
      expect(email).toBe('ctx_user@example.com');
      expect(mockCtx.access.getIdentity).toHaveBeenCalledTimes(1);
    });

    it('throttles JWKS refetches when an unknown kid is presented within cooldown window', async () => {
      resetAccessJwksCache();
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      );
      const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ ...pubJwk, kid: 'known-kid', kty: 'RSA' }],
          }),
          { status: 200 },
        ),
      );

      const header1 = btoa(JSON.stringify({ alg: 'RS256', kid: 'unknown-1' }));
      const header2 = btoa(JSON.stringify({ alg: 'RS256', kid: 'unknown-2' }));
      const payload = btoa(
        JSON.stringify({
          email: 'user@example.com',
          iss: 'https://team.cloudflareaccess.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );

      const now = 1_700_000_000_000;
      await verifyAccessJwt(`${header1}.${payload}.sig`, {
        teamDomain: 'team.cloudflareaccess.com',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs: now,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second unknown kid 5 seconds later should NOT trigger another JWKS fetch
      await verifyAccessJwt(`${header2}.${payload}.sig`, {
        teamDomain: 'team.cloudflareaccess.com',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs: now + 5000,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
