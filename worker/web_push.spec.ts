import { describe, it, expect, vi } from 'vitest';
import {
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
  createVapidAuthHeader,
  encryptWebPushPayload,
  sendWebPushNotification,
  DEFAULT_VAPID_PUBLIC_KEY,
  DEFAULT_VAPID_JWK,
  WebPushSubscription,
} from './web_push';

describe('Web Push Helper (RFC 8291 & RFC 8292)', () => {
  it('should round-trip base64url encode and decode', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const encoded = uint8ArrayToBase64Url(raw);
    const decoded = base64UrlToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(raw));
  });

  it('should generate a valid VAPID authorization header', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/fake-sub-token';
    const authHeader = await createVapidAuthHeader(endpoint, {
      subject: 'mailto:test@gagglog.com',
      publicKey: DEFAULT_VAPID_PUBLIC_KEY,
      privateKeyJwk: DEFAULT_VAPID_JWK,
    });

    expect(authHeader.startsWith('vapid t=')).toBe(true);
    expect(authHeader.includes(`, k=${DEFAULT_VAPID_PUBLIC_KEY}`)).toBe(true);

    const match = authHeader.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const jwt = match![1];
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);

    // Decode header & claims
    const headerJson = new TextDecoder().decode(
      base64UrlToUint8Array(parts[0]),
    );
    const claimsJson = new TextDecoder().decode(
      base64UrlToUint8Array(parts[1]),
    );
    const header = JSON.parse(headerJson);
    const claims = JSON.parse(claimsJson);

    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('JWT');
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:test@gagglog.com');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should encrypt a payload according to RFC 8291 and support client-side decryption', async () => {
    // 1. Generate client User-Agent keys
    const uaKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const uaPublicRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', uaKeyPair.publicKey),
    );
    const uaPublicB64 = uint8ArrayToBase64Url(uaPublicRaw);
    const uaAuthRaw = crypto.getRandomValues(new Uint8Array(16));
    const uaAuthB64 = uint8ArrayToBase64Url(uaAuthRaw);

    const message = JSON.stringify({
      title: 'Deal Alert: Xenoblade Chronicles 2',
      body: 'Now $39.99 (33% off) at VGP!',
      data: { url: '/item/xenoblade-chronicles-2-nintendo-switch' },
    });

    // 2. Encrypt using helper
    const encryptedBytes = await encryptWebPushPayload(
      uaPublicB64,
      uaAuthB64,
      message,
    );

    expect(encryptedBytes.length).toBeGreaterThan(86); // 86 bytes header + ciphertext

    // 3. Client decrypts ciphertext using uaKeyPair.privateKey
    const salt = encryptedBytes.subarray(0, 16);
    const idLen = encryptedBytes[20];
    expect(idLen).toBe(65);
    const asPublicRaw = encryptedBytes.subarray(21, 21 + idLen);
    const ciphertext = encryptedBytes.subarray(21 + idLen);

    const asPublicKey = await crypto.subtle.importKey(
      'raw',
      asPublicRaw as unknown as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );

    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: asPublicKey },
      uaKeyPair.privateKey,
      256,
    );
    const sharedSecret = new Uint8Array(sharedSecretBits);

    // HKDF helper for test verification
    async function hmac(keyBytes: Uint8Array, data: Uint8Array) {
      const k = await crypto.subtle.importKey(
        'raw',
        keyBytes as unknown as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      return new Uint8Array(
        await crypto.subtle.sign('HMAC', k, data as unknown as BufferSource),
      );
    }

    const prk = await hmac(uaAuthRaw, sharedSecret);

    const encoder = new TextEncoder();
    const webpushInfoPrefix = encoder.encode('WebPush: info\0');
    const keyInfo = new Uint8Array(
      webpushInfoPrefix.length + uaPublicRaw.length + asPublicRaw.length,
    );
    keyInfo.set(webpushInfoPrefix, 0);
    keyInfo.set(uaPublicRaw, webpushInfoPrefix.length);
    keyInfo.set(asPublicRaw, webpushInfoPrefix.length + uaPublicRaw.length);

    const t1Data = new Uint8Array(keyInfo.length + 1);
    t1Data.set(keyInfo, 0);
    t1Data[keyInfo.length] = 1;
    const ikm = (await hmac(prk, t1Data)).subarray(0, 32);

    const prk2 = await hmac(salt, ikm);

    const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
    const tCek = new Uint8Array(cekInfo.length + 1);
    tCek.set(cekInfo, 0);
    tCek[cekInfo.length] = 1;
    const cek = (await hmac(prk2, tCek)).subarray(0, 16);

    const nonceInfo = encoder.encode('Content-Encoding: nonce\0');
    const tNonce = new Uint8Array(nonceInfo.length + 1);
    tNonce.set(nonceInfo, 0);
    tNonce[nonceInfo.length] = 1;
    const nonce = (await hmac(prk2, tNonce)).subarray(0, 12);

    const aesKey = await crypto.subtle.importKey(
      'raw',
      cek as unknown as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    );

    const decryptedPaddedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 },
      aesKey,
      ciphertext as unknown as BufferSource,
    );
    const decryptedPadded = new Uint8Array(decryptedPaddedBuffer);

    let lastIdx = decryptedPadded.length - 1;
    while (lastIdx >= 0 && decryptedPadded[lastIdx] === 0) {
      lastIdx--;
    }
    expect(decryptedPadded[lastIdx]).toBe(2);

    const decrypted = new TextDecoder().decode(
      decryptedPadded.subarray(0, lastIdx),
    );
    expect(decrypted).toBe(message);
  });

  it('should dispatch push notification using mock fetch and return status', async () => {
    const uaKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const uaPublicB64 = uint8ArrayToBase64Url(
      new Uint8Array(await crypto.subtle.exportKey('raw', uaKeyPair.publicKey)),
    );
    const uaAuthB64 = uint8ArrayToBase64Url(
      crypto.getRandomValues(new Uint8Array(16)),
    );

    const sub: WebPushSubscription = {
      endpoint:
        'https://updates.push.services.mozilla.com/wpush/v2/fake-endpoint',
      p256dh: uaPublicB64,
      auth: uaAuthB64,
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 201 }));

    const result = await sendWebPushNotification(
      sub,
      {
        title: 'Deal Alert',
        body: 'Game on sale!',
      },
      { fetchFn: mockFetch as unknown as typeof fetch },
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe(201);
    expect(result.shouldDelete).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [callUrl, callOptions] = mockFetch.mock.calls[0];
    expect(callUrl).toBe(sub.endpoint);
    expect(callOptions.headers['Content-Encoding']).toBe('aes128gcm');
    expect(callOptions.headers['Authorization']).toContain('vapid t=');
  });

  it('should mark shouldDelete=true when push service returns 410 Gone or 404', async () => {
    const uaKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const uaPublicB64 = uint8ArrayToBase64Url(
      new Uint8Array(await crypto.subtle.exportKey('raw', uaKeyPair.publicKey)),
    );
    const uaAuthB64 = uint8ArrayToBase64Url(
      crypto.getRandomValues(new Uint8Array(16)),
    );

    const sub: WebPushSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/expired-token',
      p256dh: uaPublicB64,
      auth: uaAuthB64,
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 410 }));

    const result = await sendWebPushNotification(
      sub,
      { title: 'Expired', body: 'Test' },
      { fetchFn: mockFetch as unknown as typeof fetch },
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(410);
    expect(result.shouldDelete).toBe(true);
  });
});
