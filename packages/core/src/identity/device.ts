/**
 * Device identity management.
 * Generates and persists a unique device identity.
 */

import type { DeviceIdentity, PlatformType, TransportCapability } from '../protocol/types.js';
import { generateSessionKeyPair, generateFingerprint } from '../crypto/encryption.js';

/**
 * Generate a UUID v4.
 */
function generateUUID(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Detect the current platform.
 */
export function detectPlatform(): PlatformType {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'web';
  }
  if (typeof process !== 'undefined' && process.versions?.electron) {
    const platform = process.platform;
    if (platform === 'win32') return 'desktop-windows';
    if (platform === 'darwin') return 'desktop-macos';
    return 'desktop-linux';
  }
  if (typeof process !== 'undefined') {
    const platform = process.platform;
    if (platform === 'win32') return 'desktop-windows';
    if (platform === 'darwin') return 'desktop-macos';
    return 'desktop-linux';
  }
  return 'web';
}

/**
 * Detect available transport capabilities based on platform.
 */
export function detectCapabilities(platform: PlatformType): TransportCapability[] {
  switch (platform) {
    case 'web':
      return ['webrtc'];
    case 'android':
      return ['lan-http', 'direct-socket', 'wifi-direct', 'webrtc'];
    case 'desktop-windows':
    case 'desktop-macos':
    case 'desktop-linux':
      return ['lan-http', 'direct-socket', 'webrtc'];
    default:
      return ['webrtc'];
  }
}

/**
 * Get a human-readable device name.
 */
export function getDefaultDeviceName(platform: PlatformType): string {
  const prefix = {
    'web': 'Browser',
    'android': 'Android',
    'desktop-windows': 'Windows PC',
    'desktop-macos': 'Mac',
    'desktop-linux': 'Linux PC',
  }[platform];
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

/** Storage interface for persisting identity */
export interface IdentityStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** In-memory storage fallback */
class MemoryStorage implements IdentityStorage {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

/** LocalStorage adapter for web — shared across tabs (use for persistent settings) */
export class LocalStorageAdapter implements IdentityStorage {
  async get(key: string): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(`p2p-drop:${key}`);
  }
  async set(key: string, value: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`p2p-drop:${key}`, value);
  }
}

/** SessionStorage adapter for web — unique per tab (use for per-tab identity) */
export class SessionStorageAdapter implements IdentityStorage {
  async get(key: string): Promise<string | null> {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(`p2p-drop:${key}`);
  }
  async set(key: string, value: string): Promise<void> {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(`p2p-drop:${key}`, value);
  }
}

const IDENTITY_KEY = 'device-identity';

/**
 * Create or load a device identity.
 */
export async function getOrCreateIdentity(
  storage?: IdentityStorage,
  overrideName?: string
): Promise<DeviceIdentity> {
  const store = storage ?? new MemoryStorage();

  const existing = await store.get(IDENTITY_KEY);
  if (existing) {
    const identity = JSON.parse(existing) as DeviceIdentity;
    if (overrideName) {
      identity.deviceName = overrideName;
    }
    return identity;
  }

  const platform = detectPlatform();
  const capabilities = detectCapabilities(platform);
  const keyPair = await generateSessionKeyPair();
  const fingerprint = await generateFingerprint(keyPair.publicKeyRaw);

  const identity: DeviceIdentity = {
    deviceId: generateUUID(),
    deviceName: overrideName ?? getDefaultDeviceName(platform),
    platform,
    capabilities,
    publicKeyFingerprint: fingerprint,
  };

  await store.set(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}
