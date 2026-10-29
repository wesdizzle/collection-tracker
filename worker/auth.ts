/**
 * MULTI-USER AUTHENTICATION
 *
 * Identity flow:
 * 1. The browser visits `/api/auth/login`, a path protected by Cloudflare Access. Access performs
 *    the OTP/IdP login and forwards the request with a signed `Cf-Access-Jwt-Assertion` header
 *    (and `CF_Authorization` cookie).
 * 2. `verifyAccessJwt` validates that RS256 JWT against the team's public JWKS (issuer, audience,
 *    expiry), yielding a trustworthy email.
 * 3. The email is looked up in `users` (admin-seeded allowlist; no self sign-up). On success the
 *    worker mints an `app_user_session` cookie: an HMAC-SHA256 signed payload carrying the user id,
 *    username, role and home region.
 * 4. Every later request is authenticated by verifying that HMAC: pure CPU, zero D1 reads.
 *
 * Local development: on localhost only, `DEV_AUTH_EMAIL` (or User #1 when unset) is accepted in
 * place of an Access JWT so the login flow can be exercised without Cloudflare.
 */

export const SESSION_COOKIE = 'app_user_session';
export const DEFAULT_SESSION_DAYS = 30;

export type UserRole = 'admin' | 'user';

/** Claims carried in the signed session cookie. Short keys keep the cookie small. */
export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
  homeRegion: string;
}

interface SessionPayload {
  uid: number;
  un: string;
  r: UserRole;
  hr: string;
  exp: number; // unix seconds
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function getHmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    hmacKeyCache.set(secret, key);
  }
  return key;
}

/**
 * Signs a session for `user` valid for `days`. Format: `<base64url(payload)>.<base64url(hmac)>`.
 */
export async function signSession(
  user: SessionUser,
  secret: string,
  days: number = DEFAULT_SESSION_DAYS,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  const payload: SessionPayload = {
    uid: user.id,
    un: user.username,
    r: user.role,
    hr: user.homeRegion,
    exp: Math.floor(nowMs / 1000) + Math.round(days * 86400),
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    'HMAC',
    await getHmacKey(secret),
    encoder.encode(body),
  );
  return `${body}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/**
 * Verifies a session token. Returns null for missing, malformed, tampered, or expired tokens.
 * Uses `crypto.subtle.verify`, which compares in constant time.
 */
export async function verifySession(
  token: string | null | undefined,
  secret: string | undefined,
  nowMs: number = Date.now(),
): Promise<SessionUser | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await getHmacKey(secret),
      base64UrlDecode(sigPart) as BufferSource,
      encoder.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body)),
    ) as SessionPayload;
    if (
      typeof payload.uid !== 'number' ||
      typeof payload.un !== 'string' ||
      (payload.r !== 'admin' && payload.r !== 'user') ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(nowMs / 1000)
    ) {
      return null;
    }
    return {
      id: payload.uid,
      username: payload.un,
      role: payload.r,
      homeRegion:
        typeof payload.hr === 'string' && payload.hr ? payload.hr : 'USA',
    };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = part.slice(idx + 1).trim();
  }
  return out;
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** True only when the request URL itself targets a loopback host (not spoofable via headers). */
export function isLoopbackRequest(url: URL): boolean {
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  );
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT verification
// ---------------------------------------------------------------------------

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let jwksCache: {
  teamDomain: string;
  keys: Map<string, CryptoKey>;
  expiresAt: number;
} | null = null;

async function getAccessSigningKey(
  teamDomain: string,
  kid: string,
  fetchFn: typeof fetch,
): Promise<CryptoKey | null> {
  const now = Date.now();
  if (
    !jwksCache ||
    jwksCache.teamDomain !== teamDomain ||
    jwksCache.expiresAt < now ||
    !jwksCache.keys.has(kid)
  ) {
    const res = await fetchFn(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Failed to fetch Access certs: ${res.status}`);
    const data = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of data.keys || []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(jwk.kid, key);
    }
    jwksCache = { teamDomain, keys, expiresAt: now + 60 * 60 * 1000 };
  }
  return jwksCache.keys.get(kid) || null;
}

/** Test hook. */
export function resetAccessJwksCache(): void {
  jwksCache = null;
}

/**
 * Verifies a Cloudflare Access application JWT and returns the authenticated email, or null.
 * Checks RS256 signature against the team JWKS, `iss`, `aud` (when `audience` is configured),
 * `exp` and `nbf`.
 */
export async function verifyAccessJwt(
  jwt: string | null | undefined,
  opts: {
    teamDomain: string;
    audience?: string;
    fetchFn?: typeof fetch;
    nowMs?: number;
  },
): Promise<string | null> {
  if (!jwt || !opts.teamDomain) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[0])),
    ) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const key = await getAccessSigningKey(
      opts.teamDomain,
      header.kid,
      opts.fetchFn || fetch,
    );
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(parts[2]) as BufferSource,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[1])),
    ) as {
      email?: string;
      iss?: string;
      aud?: string | string[];
      exp?: number;
      nbf?: number;
    };
    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
    if (!payload.exp || payload.exp <= nowSec) return null;
    if (payload.nbf && payload.nbf > nowSec + 60) return null;
    if (payload.iss !== `https://${opts.teamDomain}`) return null;
    if (opts.audience) {
      const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!auds.includes(opts.audience)) return null;
    }
    return typeof payload.email === 'string' && payload.email.includes('@')
      ? payload.email.toLowerCase()
      : null;
  } catch (err) {
    console.warn('[auth] Access JWT verification failed:', err);
    return null;
  }
}

/** Home regions a user may select. Values align with REGION_ANCESTORS in collection.models.ts. */
export const ALLOWED_HOME_REGIONS = [
  'USA',
  'Canada',
  'Mexico',
  'Brazil',
  'Europe',
  'UK',
  'France',
  'Germany',
  'Italy',
  'Spain',
  'Netherlands',
  'Scandinavia',
  'Japan',
  'Korea',
  'China',
  'Taiwan',
  'Hong Kong',
  'Australia',
  'New Zealand',
] as const;

export function normalizeHomeRegion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ALLOWED_HOME_REGIONS.find(
    (r) => r.toLowerCase() === value.trim().toLowerCase(),
  );
  return match || null;
}
