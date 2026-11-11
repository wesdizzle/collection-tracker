import {
  HOST_SESSION_COOKIE as KIT_HOST_SESSION_COOKIE,
  SESSION_COOKIE as KIT_SESSION_COOKIE,
  DEFAULT_SESSION_DAYS as KIT_DEFAULT_SESSION_DAYS,
  HOST_OIDC_STATE_COOKIE as KIT_HOST_OIDC_STATE_COOKIE,
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
  isSecureOrigin,
  getSessionCookieName,
  getOidcStateCookieName,
  readSessionCookie,
  readOidcStateCookie,
  serializeSessionCookie,
  serializeClearSessionCookies,
  serializeOidcStateCookie,
  serializeClearOidcStateCookies,
  sanitizeReturnToPath,
  resolveStrongSecret,
  isCrossOriginMutatingRequest,
  validateSameOriginMutation,
  buildCspHeader,
  withSecurityHeaders as kitWithSecurityHeaders,
  timingSafeEqualStrings,
  resetOidcJwksCache,
  verifyOidcIdToken,
} from '@wesdizzle/app-kit/worker';

export const HOST_SESSION_COOKIE = KIT_HOST_SESSION_COOKIE;
export const SESSION_COOKIE = KIT_SESSION_COOKIE;
export const DEFAULT_SESSION_DAYS = KIT_DEFAULT_SESSION_DAYS;
export const HOST_OIDC_STATE_COOKIE = KIT_HOST_OIDC_STATE_COOKIE;
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
  isSecureOrigin,
  getSessionCookieName,
  getOidcStateCookieName,
  readSessionCookie,
  readOidcStateCookie,
  serializeSessionCookie,
  serializeClearSessionCookies,
  serializeOidcStateCookie,
  serializeClearOidcStateCookies,
  sanitizeReturnToPath,
  resolveStrongSecret,
  isCrossOriginMutatingRequest,
  validateSameOriginMutation,
  buildCspHeader,
  kitWithSecurityHeaders,
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
  return serializeSessionCookie(token, secure, maxAgeSeconds);
}

export function clearSessionCookie(secure: boolean): string {
  return serializeClearSessionCookies(secure)[0];
}

export function buildOidcStateCookie(
  token: string,
  maxAgeSeconds: number = OIDC_STATE_TTL_SECONDS,
  secure: boolean = true,
): string {
  return serializeOidcStateCookie(token, secure, maxAgeSeconds);
}

export function clearOidcStateCookie(secure: boolean = true): string {
  return serializeClearOidcStateCookies(secure)[0];
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
