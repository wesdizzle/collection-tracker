import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signSession,
  verifySession,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  normalizeHomeRegion,
  timingSafeEqualStrings,
  generateRandomBase64Url,
  computePkceCodeChallenge,
  signOidcStateCookie,
  verifyOidcStateCookie,
  buildOidcStateCookie,
  clearOidcStateCookie,
  verifyOidcIdToken,
  resetOidcJwksCache,
  SessionUser,
  OidcStatePayload,
} from './auth.js';

function base64UrlEncodeString(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('worker/auth', () => {
  const secret = 'super-secret-test-key-32-characters-long!';
  const user: SessionUser = {
    id: 1,
    username: 'collector',
    role: 'admin',
    homeRegion: 'USA',
  };

  beforeEach(() => {
    resetOidcJwksCache();
  });

  it('signs and verifies a valid session token', async () => {
    const token = await signSession(user, secret, 30);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');

    const verified = await verifySession(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(1);
    expect(verified?.username).toBe('collector');
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

  it('builds session cookie with __Host- prefix and security flags on HTTPS', () => {
    const cookie = buildSessionCookie('mytoken', 3600, true);
    expect(cookie).toContain('__Host-app_user_session=mytoken');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');

    const localCookie = buildSessionCookie('mytoken', 3600, false);
    expect(localCookie).toContain('app_user_session=mytoken');
    expect(localCookie).not.toContain('__Host-');
  });

  it('builds clearing cookie with zero Max-Age', () => {
    const cookie = clearSessionCookie(false);
    expect(cookie).toContain('app_user_session=;');
    expect(cookie).toContain('Max-Age=0');

    const secureClear = clearSessionCookie(true);
    expect(secureClear).toContain('__Host-app_user_session=;');
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

  describe('PKCE S256 & OIDC State Cookie', () => {
    it('computes RFC 7636 S256 code_challenge accurately and generates random base64url strings', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await computePkceCodeChallenge(verifier);
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');

      const randomStr = generateRandomBase64Url(32);
      expect(randomStr.length).toBeGreaterThanOrEqual(42);
      expect(randomStr).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('signs, verifies, and expires OIDC state cookies', async () => {
      const nowMs = 1_700_000_000_000;
      const statePayload: OidcStatePayload = {
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
        redirectUri: 'https://tracker.example.com/api/auth/callback',
        exp: Math.floor(nowMs / 1000) + 600,
      };

      const signed = await signOidcStateCookie(statePayload, secret);
      const verified = await verifyOidcStateCookie(signed, secret, nowMs);
      expect(verified).toEqual(statePayload);

      // Expired check
      const expired = await verifyOidcStateCookie(
        signed,
        secret,
        nowMs + 601_000,
      );
      expect(expired).toBeNull();

      // Tampered check
      const tampered = signed.slice(0, -3) + 'abc';
      expect(await verifyOidcStateCookie(tampered, secret, nowMs)).toBeNull();

      // Cookie header builders
      const setCookie = buildOidcStateCookie(signed, 600, true);
      expect(setCookie).toContain('__Host-app_oidc_state=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain('Secure');

      const clearCookie = clearOidcStateCookie(true);
      expect(clearCookie).toContain('__Host-app_oidc_state=;');
      expect(clearCookie).toContain('Max-Age=0');
    });
  });

  describe('verifyOidcIdToken', () => {
    it('verifies ES256 OIDC ID tokens and validates issuer, audience, nonce, and exp', async () => {
      const ecKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const pubJwk = await crypto.subtle.exportKey('jwk', ecKeyPair.publicKey);
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ ...pubJwk, kid: 'ec-key-1', alg: 'ES256', use: 'sig' }],
          }),
          { status: 200 },
        ),
      );

      const nowMs = 1_700_000_000_000;
      const nowSec = Math.floor(nowMs / 1000);
      const headerB64 = base64UrlEncodeString(
        JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'ec-key-1' }),
      );
      const claimsPayload = {
        iss: 'https://id.example.com',
        sub: 'user-uuid-1',
        aud: 'collection-tracker',
        exp: nowSec + 300,
        iat: nowSec,
        nonce: 'expected-nonce-123',
        email: 'admin@example.com',
        preferred_username: 'collector',
        role: 'admin',
      };
      const payloadB64 = base64UrlEncodeString(JSON.stringify(claimsPayload));
      const signingInput = new TextEncoder().encode(
        `${headerB64}.${payloadB64}`,
      );
      const sigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        ecKeyPair.privateKey,
        signingInput,
      );
      const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuffer));
      const idToken = `${headerB64}.${payloadB64}.${sigB64}`;

      const verified = await verifyOidcIdToken(idToken, {
        issuer: 'https://id.example.com',
        clientId: 'collection-tracker',
        expectedNonce: 'expected-nonce-123',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs,
      });

      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe('user-uuid-1');
      expect(verified?.email).toBe('admin@example.com');
      expect(verified?.preferred_username).toBe('collector');
      expect(verified?.role).toBe('admin');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Wrong nonce rejected
      const wrongNonce = await verifyOidcIdToken(idToken, {
        issuer: 'https://id.example.com',
        clientId: 'collection-tracker',
        expectedNonce: 'wrong-nonce',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs,
      });
      expect(wrongNonce).toBeNull();

      // Wrong clientId rejected
      const wrongClient = await verifyOidcIdToken(idToken, {
        issuer: 'https://id.example.com',
        clientId: 'other-client',
        expectedNonce: 'expected-nonce-123',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs,
      });
      expect(wrongClient).toBeNull();

      // Expired token rejected
      const expired = await verifyOidcIdToken(idToken, {
        issuer: 'https://id.example.com',
        clientId: 'collection-tracker',
        expectedNonce: 'expected-nonce-123',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs: nowMs + 400_000,
      });
      expect(expired).toBeNull();
    });

    it('verifies RS256 OIDC ID tokens and throttles JWKS refetches within 60s cooldown', async () => {
      const rsaKeyPair = await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      );
      const pubJwk = await crypto.subtle.exportKey('jwk', rsaKeyPair.publicKey);
      const mockFetch = vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...pubJwk, kid: 'rsa-kid-1', kty: 'RSA', alg: 'RS256' }],
            }),
            { status: 200 },
          ),
      );

      const nowMs = 1_700_000_000_000;
      const nowSec = Math.floor(nowMs / 1000);
      const headerB64 = base64UrlEncodeString(
        JSON.stringify({ alg: 'RS256', kid: 'rsa-kid-1' }),
      );
      const payloadB64 = base64UrlEncodeString(
        JSON.stringify({
          iss: 'https://id.example.com',
          sub: 'rsa-sub-1',
          aud: ['collection-tracker'],
          exp: nowSec + 3600,
          nonce: 'rsa-nonce',
          email: 'user@example.com',
        }),
      );
      const signingInput = new TextEncoder().encode(
        `${headerB64}.${payloadB64}`,
      );
      const sigBuffer = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        rsaKeyPair.privateKey,
        signingInput,
      );
      const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuffer));
      const validRsaToken = `${headerB64}.${payloadB64}.${sigB64}`;

      const verified = await verifyOidcIdToken(validRsaToken, {
        issuer: 'https://id.example.com',
        clientId: 'collection-tracker',
        expectedNonce: 'rsa-nonce',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs,
      });
      expect(verified?.sub).toBe('rsa-sub-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Unknown kid within 60s cooldown should NOT trigger another JWKS fetch
      const unknownHeader1 = base64UrlEncodeString(
        JSON.stringify({ alg: 'RS256', kid: 'unknown-1' }),
      );
      await verifyOidcIdToken(`${unknownHeader1}.${payloadB64}.sig`, {
        issuer: 'https://id.example.com',
        clientId: 'collection-tracker',
        fetchFn: mockFetch as unknown as typeof fetch,
        nowMs: nowMs + 5000,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
