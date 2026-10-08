/**
 * EDGE-NATIVE WEB PUSH HELPER (RFC 8291 & RFC 8292)
 *
 * Implements Web Push Notification payload encryption (aes128gcm)
 * and VAPID authentication directly via standard Web Crypto (`crypto.subtle`).
 *
 * Runs seamlessly on Cloudflare Workers edge runtime with zero external Node dependencies.
 */

export interface VapidJwk {
  kty: string;
  crv: string;
  d: string;
  x: string;
  y: string;
}

export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    [key: string]: unknown;
  };
}

export interface SendWebPushResult {
  success: boolean;
  status: number;
  shouldDelete: boolean;
  error?: string;
}

export const DEFAULT_VAPID_PUBLIC_KEY =
  'BCGrFeDrM518iDUIN5JmVLjL6ZvnxY72gPvM8V7azLh28SCHmvjOCVrbzy8R4qV4-dKSs3zDevg6dmOLbMJgcvk';

export const DEFAULT_VAPID_JWK: VapidJwk = {
  kty: 'EC',
  crv: 'P-256',
  d: 'Os98o3kTLG-DuhuH0BeUA5jfiPb-cqzS7-OCxiC4q20',
  x: 'IasV4OsznXyINQg3kmZUuMvpm-fFjvaA-8zxXtrMuHY',
  y: '8SCHmvjOCVrbzy8R4qV4-dKSs3zDevg6dmOLbMJgcvk',
};

/**
 * Base64URL string to Uint8Array.
 */
export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Uint8Array to Base64URL string.
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * HMAC-SHA-256 using Web Crypto subtle.
 */
async function hmacSha256(
  keyBytes: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    data as unknown as BufferSource,
  );
  return new Uint8Array(signature);
}

/**
 * HKDF-Extract(salt, IKM)
 */
async function hkdfExtract(
  salt: Uint8Array,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

/**
 * HKDF-Expand(PRK, info, length) for length <= 32 bytes.
 */
async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const data = new Uint8Array(info.length + 1);
  data.set(info, 0);
  data[info.length] = 1;
  const t = await hmacSha256(prk, data);
  return t.subarray(0, length);
}

/**
 * Generates an RFC 8292 VAPID Authorization header string for a given push endpoint.
 */
export async function createVapidAuthHeader(
  endpoint: string,
  options?: {
    subject?: string;
    publicKey?: string;
    privateKeyJwk?: VapidJwk;
  },
): Promise<string> {
  const publicKey = options?.publicKey || DEFAULT_VAPID_PUBLIC_KEY;
  const jwk = options?.privateKeyJwk || DEFAULT_VAPID_JWK;
  const subject = options?.subject || 'mailto:admin@collection-tracker.local';

  const origin = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 hours expiry

  const headerObj = { alg: 'ES256', typ: 'JWT' };
  const payloadObj = { aud: origin, exp, sub: subject };

  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToBase64Url(
    encoder.encode(JSON.stringify(headerObj)),
  );
  const payloadB64 = uint8ArrayToBase64Url(
    encoder.encode(JSON.stringify(payloadObj)),
  );
  const signInput = `${headerB64}.${payloadB64}`;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(signInput) as unknown as BufferSource,
  );

  const sigB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  const jwt = `${signInput}.${sigB64}`;

  return `vapid t=${jwt}, k=${publicKey}`;
}

/**
 * Encrypts a plaintext payload using RFC 8291 `aes128gcm` standard.
 */
export async function encryptWebPushPayload(
  clientPublicKeyB64: string,
  clientAuthSecretB64: string,
  plaintext: string,
): Promise<Uint8Array> {
  const uaPublicRaw = base64UrlToUint8Array(clientPublicKeyB64);
  const uaAuth = base64UrlToUint8Array(clientAuthSecretB64);

  // 1. Generate ephemeral ECDH key pair on curve P-256
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const asPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', asKeyPair.publicKey),
  );

  // 2. Import UA public key
  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublicRaw as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // 3. Derive shared secret via ECDH
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublicKey },
    asKeyPair.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // 4. Generate random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. HKDF key derivation
  const prk = await hkdfExtract(uaAuth, sharedSecret);

  const encoder = new TextEncoder();
  const webpushInfoPrefix = encoder.encode('WebPush: info\0');
  const keyInfo = new Uint8Array(
    webpushInfoPrefix.length + uaPublicRaw.length + asPublicRaw.length,
  );
  keyInfo.set(webpushInfoPrefix, 0);
  keyInfo.set(uaPublicRaw, webpushInfoPrefix.length);
  keyInfo.set(asPublicRaw, webpushInfoPrefix.length + uaPublicRaw.length);

  const ikm = await hkdfExpand(prk, keyInfo, 32);
  const prk2 = await hkdfExtract(salt, ikm);

  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdfExpand(prk2, cekInfo, 16);

  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);

  // 6. Delimit payload with 0x02
  const plaintextBytes = encoder.encode(plaintext);
  const padded = new Uint8Array(plaintextBytes.length + 1);
  padded.set(plaintextBytes, 0);
  padded[plaintextBytes.length] = 2; // RFC 8291 record delimiter

  // 7. Encrypt with AES-GCM
  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek as unknown as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 },
    aesKey,
    padded as unknown as BufferSource,
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  // 8. Construct RFC 8291 header:
  // salt (16B) || rs (4B uint32 = 4096) || idlen (1B = 65) || as_public (65B)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const rs = 4096;
  header[16] = (rs >> 24) & 0xff;
  header[17] = (rs >> 16) & 0xff;
  header[18] = (rs >> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);

  const fullPayload = new Uint8Array(header.length + ciphertext.length);
  fullPayload.set(header, 0);
  fullPayload.set(ciphertext, header.length);

  return fullPayload;
}

/**
 * Dispatches an encrypted Web Push notification to a push subscription.
 */
export async function sendWebPushNotification(
  subscription: WebPushSubscription,
  payload: WebPushNotificationPayload,
  options?: {
    subject?: string;
    publicKey?: string;
    privateKeyJwk?: VapidJwk;
    fetchFn?: typeof fetch;
  },
): Promise<SendWebPushResult> {
  const fetchFn = options?.fetchFn || fetch;

  try {
    const encryptedBody = await encryptWebPushPayload(
      subscription.p256dh,
      subscription.auth,
      JSON.stringify(payload),
    );

    const authHeader = await createVapidAuthHeader(
      subscription.endpoint,
      options,
    );

    const response = await fetchFn(subscription.endpoint, {
      method: 'POST',
      headers: {
        TTL: '86400',
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: authHeader,
      },
      body: encryptedBody as unknown as BodyInit,
    });

    const status = response.status;
    const shouldDelete = status === 404 || status === 410;
    const success = response.ok || status === 201;

    return {
      success,
      status,
      shouldDelete,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 0,
      shouldDelete: false,
      error: msg,
    };
  }
}
