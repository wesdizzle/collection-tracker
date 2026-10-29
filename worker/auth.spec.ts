import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  normalizeHomeRegion,
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
});
