/**
 * Discovery interfaces and utilities.
 * Each platform implements these interfaces with platform-specific discovery.
 */

import type { DeviceIdentity, DiscoveryAnnouncement, PairingInfo } from '../protocol/types.js';
import { arrayBufferToBase64 } from '../crypto/encryption.js';

/** Discovered peer device */
export interface DiscoveredPeer {
  device: DeviceIdentity;
  /** How the peer was discovered */
  method: 'mdns' | 'wifi-direct' | 'nsd' | 'qr-code' | 'manual-link' | 'signaling';
  /** Network address */
  address: string;
  /** HTTP port (if available) */
  httpPort?: number;
  /** Socket port (if available) */
  socketPort?: number;
  /** When the peer was last seen */
  lastSeen: number;
  /** Signal strength or quality indicator (0-100) */
  quality: number;
}

/** Discovery service interface */
export interface DiscoveryService {
  /** Start announcing this device on the network */
  startAnnouncing(announcement: DiscoveryAnnouncement): Promise<void>;
  /** Stop announcing */
  stopAnnouncing(): Promise<void>;
  /** Start scanning for peers */
  startScanning(): Promise<void>;
  /** Stop scanning */
  stopScanning(): Promise<void>;
  /** Register handler for discovered peers */
  onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void;
  /** Register handler for lost peers */
  onPeerLost(handler: (deviceId: string) => void): void;
  /** Get currently known peers */
  getKnownPeers(): DiscoveredPeer[];
}

/**
 * Generate pairing info for QR code or link sharing.
 */
export function generatePairingInfo(
  device: DeviceIdentity,
  endpoint: string,
  expirationMinutes: number = 10
): PairingInfo {
  const codeBytes = new Uint8Array(6);
  if (typeof globalThis.crypto !== 'undefined') {
    globalThis.crypto.getRandomValues(codeBytes);
  } else {
    for (let i = 0; i < 6; i++) {
      codeBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const pairingCode = arrayBufferToBase64(codeBytes.buffer)
    .replace(/[+/=]/g, '')
    .substring(0, 6)
    .toUpperCase();

  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

  return {
    device,
    endpoint,
    pairingCode,
    expiresAt,
  };
}

/**
 * Generate a shareable pairing URL.
 */
export function generatePairingURL(
  baseURL: string,
  pairingInfo: PairingInfo
): string {
  const encoded = btoa(JSON.stringify(pairingInfo));
  return `${baseURL}#pair=${encoded}`;
}

/**
 * Parse a pairing URL back to PairingInfo.
 */
export function parsePairingURL(url: string): PairingInfo | null {
  try {
    const hash = url.split('#pair=')[1];
    if (!hash) return null;
    return JSON.parse(atob(hash)) as PairingInfo;
  } catch {
    return null;
  }
}

/**
 * Generate QR code data from pairing info.
 * Returns a string suitable for QR code generation.
 */
export function generateQRData(pairingInfo: PairingInfo): string {
  return JSON.stringify({
    p2pd: 1, // P2P Drop version marker
    d: pairingInfo.device.deviceId,
    n: pairingInfo.device.deviceName,
    e: pairingInfo.endpoint,
    c: pairingInfo.pairingCode,
    x: pairingInfo.expiresAt,
  });
}

/**
 * Parse QR code data back to essential pairing fields.
 */
export function parseQRData(data: string): { deviceId: string; deviceName: string; endpoint: string; pairingCode: string; expiresAt: string } | null {
  try {
    const parsed = JSON.parse(data) as { p2pd?: number; d?: string; n?: string; e?: string; c?: string; x?: string };
    if (parsed.p2pd !== 1) return null;
    if (!parsed.d || !parsed.e || !parsed.c || !parsed.x) return null;
    return {
      deviceId: parsed.d,
      deviceName: parsed.n ?? 'Unknown',
      endpoint: parsed.e,
      pairingCode: parsed.c,
      expiresAt: parsed.x,
    };
  } catch {
    return null;
  }
}

/**
 * Select the best transport for connecting two devices.
 */
export function selectBestTransport(
  senderCapabilities: string[],
  receiverCapabilities: string[]
): string {
  // Priority order: direct-socket > lan-http > wifi-direct > webrtc
  const priority = ['direct-socket', 'lan-http', 'wifi-direct', 'webrtc'];
  for (const transport of priority) {
    if (senderCapabilities.includes(transport) && receiverCapabilities.includes(transport)) {
      return transport;
    }
  }
  return 'webrtc'; // Fallback
}
