/**
 * Encryption layer for P2P Drop.
 * Uses Web Crypto API (available in browsers, Node.js 18+, and React Native).
 * - ECDH for key exchange
 * - AES-256-GCM for data encryption
 * - SHA-256 for integrity
 */

/** Key pair for session encryption */
export interface SessionKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: ArrayBuffer;
  publicKeyBase64: string;
}

/** Derived session for encrypted communication */
export interface EncryptedSession {
  sharedSecret: CryptoKey;
  encryptionKey: CryptoKey;
}

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;

function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API not available');
}

/**
 * Generate an ECDH key pair for session key exchange.
 */
export async function generateSessionKeyPair(): Promise<SessionKeyPair> {
  const crypto = getCrypto();
  const keyPair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBase64 = arrayBufferToBase64(publicKeyRaw);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyRaw,
    publicKeyBase64,
  };
}

/**
 * Derive a shared encryption key from our private key and the peer's public key.
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyBase64: string
): Promise<EncryptedSession> {
  const crypto = getCrypto();
  const peerPublicKeyRaw = base64ToArrayBuffer(peerPublicKeyBase64);

  const peerPublicKey = await crypto.subtle.importKey(
    'raw',
    peerPublicKeyRaw,
    ECDH_PARAMS,
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );

  return { sharedSecret, encryptionKey: sharedSecret };
}

/**
 * Encrypt data using AES-256-GCM with the session key.
 */
export async function encrypt(
  session: EncryptedSession,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    session.encryptionKey,
    data
  );

  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), IV_LENGTH);

  return result.buffer;
}

/**
 * Decrypt data using AES-256-GCM with the session key.
 */
export async function decrypt(
  session: EncryptedSession,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  const uint8 = new Uint8Array(data);
  const iv = uint8.slice(0, IV_LENGTH);
  const ciphertext = uint8.slice(IV_LENGTH);

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    session.encryptionKey,
    ciphertext
  );
}

/**
 * Compute SHA-256 hash of data.
 */
export async function sha256(data: ArrayBuffer): Promise<string> {
  const crypto = getCrypto();
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

/**
 * Compute SHA-256 hash of a string.
 */
export async function sha256String(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  return sha256(data.buffer);
}

/**
 * Generate a fingerprint from a public key.
 */
export async function generateFingerprint(publicKeyRaw: ArrayBuffer): Promise<string> {
  const hash = await sha256(publicKeyRaw);
  // Format as colon-separated pairs for readability
  return hash.substring(0, 32).match(/.{2}/g)!.join(':').toUpperCase();
}

// --- Utility functions ---

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const uint8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return uint8.buffer;
}

export function arrayBufferToHex(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  return Array.from(uint8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
