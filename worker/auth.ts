import {
  SESSION_COOKIE as KIT_SESSION_COOKIE,
  DEFAULT_SESSION_DAYS as KIT_DEFAULT_SESSION_DAYS,
  OIDC_STATE_COOKIE as KIT_OIDC_STATE_COOKIE,
  OIDC_STATE_TTL_SECONDS as KIT_OIDC_STATE_TTL_SECONDS,
  UserRole,
  OidcStatePayload,
  OidcIdTokenClaims,
  base64UrlEncode,
  base64UrlDecode,
  generateRandomBase64Url,
  computePkceCodeChallenge,
  signSession as kitSignSession,
  verifySession as kitVerifySession,
  signOidcStateCookie,
  verifyOidcStateCookie,
  parseCookies,
  isLoopbackRequest,
  timingSafeEqualStrings,
  resetOidcJwksCache,
  verifyOidcIdToken,
} from '@wesdizzle/app-kit/worker';

export const SESSION_COOKIE = KIT_SESSION_COOKIE;
export const DEFAULT_SESSION_DAYS = KIT_DEFAULT_SESSION_DAYS;
export const OIDC_STATE_COOKIE = KIT_OIDC_STATE_COOKIE;
export const OIDC_STATE_TTL_SECONDS = KIT_OIDC_STATE_TTL_SECONDS;

export type { UserRole, OidcStatePayload, OidcIdTokenClaims };

/** Claims carried in the signed session cookie. Short keys keep the cookie small. */
export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
  homeRegion: string;
}

export {
  base64UrlEncode,
  base64UrlDecode,
  generateRandomBase64Url,
  computePkceCodeChallenge,
  signOidcStateCookie,
  verifyOidcStateCookie,
  parseCookies,
  isLoopbackRequest,
  timingSafeEqualStrings,
  resetOidcJwksCache,
  verifyOidcIdToken,
};

/**
 * Signs a session for `user` valid for `days`. Format: `<base64url(payload)>.<base64url(hmac)>`.
 */
export async function signSession(
  user: SessionUser,
  secret: string,
  days: number = DEFAULT_SESSION_DAYS,
  nowMs: number = Date.now(),
): Promise<string> {
  return kitSignSession(user, secret, days, nowMs);
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
  const verified = await kitVerifySession(token, secret, nowMs);
  if (!verified) return null;
  return {
    id: verified.id,
    username: verified.username,
    role: verified.role,
    homeRegion: verified.homeRegion || 'USA',
  };
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

export function buildOidcStateCookie(
  token: string,
  maxAgeSeconds: number = OIDC_STATE_TTL_SECONDS,
  secure: boolean = true,
): string {
  return `${OIDC_STATE_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearOidcStateCookie(secure: boolean = true): string {
  return `${OIDC_STATE_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
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
