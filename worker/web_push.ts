/**
 * EDGE-NATIVE WEB PUSH HELPER (RFC 8291 & RFC 8292)
 *
 * Delegates Web Push payload encryption (`aes128gcm`), VAPID signing, and
 * SSRF-hardened endpoint validation (HTTPS + port 443 + `redirect: 'error'`)
 * to `@wesdizzle/app-kit/worker`.
 */

import {
  isAllowedPushEndpoint as kitIsAllowedPushEndpoint,
  base64UrlToUint8Array as kitBase64UrlToUint8Array,
  uint8ArrayToBase64Url as kitUint8ArrayToBase64Url,
  resolveVapidSubject as kitResolveVapidSubject,
  resolveVapidJwk as kitResolveVapidJwk,
  createVapidAuthHeader as kitCreateVapidAuthHeader,
  encryptWebPushPayload as kitEncryptWebPushPayload,
  buildPushNotificationBody as kitBuildPushNotificationBody,
  sendWebPushNotification as kitSendWebPushNotification,
  type VapidJwk,
  type WebPushSubscription,
  type WebPushNotificationPayload,
  type SendWebPushOptions,
  type SendWebPushResult,
} from '@wesdizzle/app-kit/worker';

export type {
  VapidJwk,
  WebPushSubscription,
  WebPushNotificationPayload,
  SendWebPushOptions,
  SendWebPushResult,
};

export function isAllowedPushEndpoint(
  endpoint: string | null | undefined,
  allowTestHost: boolean = false,
): boolean {
  return kitIsAllowedPushEndpoint(endpoint, allowTestHost);
}

export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  return kitBase64UrlToUint8Array(base64Url);
}

export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return kitUint8ArrayToBase64Url(bytes);
}

export function resolveVapidSubject(
  subject?: string,
  requestUrl?: string,
  adminEmail?: string,
): string {
  return kitResolveVapidSubject(subject, requestUrl, adminEmail);
}

export function resolveVapidJwk(
  customPrivateKey?: string,
  customPublicKey?: string,
  explicitJwk?: VapidJwk,
): VapidJwk {
  return kitResolveVapidJwk(customPrivateKey, customPublicKey, explicitJwk);
}

export async function createVapidAuthHeader(
  endpoint: string,
  options?: SendWebPushOptions,
): Promise<string> {
  return kitCreateVapidAuthHeader(endpoint, options);
}

export async function encryptWebPushPayload(
  clientPublicKeyB64: string,
  clientAuthSecretB64: string,
  plaintext: string,
): Promise<Uint8Array> {
  return kitEncryptWebPushPayload(
    clientPublicKeyB64,
    clientAuthSecretB64,
    plaintext,
  );
}

export function buildPushNotificationBody(
  payload: WebPushNotificationPayload,
): string {
  return kitBuildPushNotificationBody(payload);
}

export async function sendWebPushNotification(
  subscription: WebPushSubscription,
  payload: WebPushNotificationPayload,
  options?: SendWebPushOptions,
): Promise<SendWebPushResult> {
  return kitSendWebPushNotification(subscription, payload, options);
}
