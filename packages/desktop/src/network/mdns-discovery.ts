/**
 * mDNS/Bonjour Discovery Service for LAN peer discovery.
 * Uses bonjour-service for cross-platform mDNS.
 */

import Bonjour from 'bonjour-service';
import type { DeviceIdentity, DiscoveryAnnouncement } from '@p2p-drop/core';
import type { DiscoveredPeer, DiscoveryService } from '@p2p-drop/core';
import { DEFAULT_HTTP_PORT } from '@p2p-drop/core';

const SERVICE_TYPE = 'p2p-drop';
const SERVICE_PROTOCOL = 'tcp';

export class MDNSDiscovery implements DiscoveryService {
  private bonjour: InstanceType<typeof Bonjour>;
  private browser: ReturnType<InstanceType<typeof Bonjour>['find']> | null = null;
  private published = false;
  private peers = new Map<string, DiscoveredPeer>();
  private peerHandlers: Array<(peer: DiscoveredPeer) => void> = [];
  private lostHandlers: Array<(deviceId: string) => void> = [];

  constructor() {
    this.bonjour = new Bonjour();
  }

  async startAnnouncing(announcement: DiscoveryAnnouncement): Promise<void> {
    if (this.published) return;

    const port = announcement.httpPort || DEFAULT_HTTP_PORT;
    this.bonjour.publish({
      name: `p2p-drop-${announcement.device.deviceId.substring(0, 8)}`,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port,
      txt: {
        deviceId: announcement.device.deviceId,
        deviceName: announcement.device.deviceName,
        platform: announcement.device.platform,
        capabilities: announcement.device.capabilities.join(','),
        fingerprint: announcement.device.publicKeyFingerprint,
        ready: announcement.readyToReceive ? '1' : '0',
      },
    });

    this.published = true;
    console.log(`[mDNS] Publishing service on port ${port}`);
  }

  async stopAnnouncing(): Promise<void> {
    if (this.published) {
      this.bonjour.unpublishAll();
      this.published = false;
    }
  }

  async startScanning(): Promise<void> {
    if (this.browser) return;

    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL });

    this.browser.on('up', (service) => {
      const txt = service.txt as Record<string, string> | undefined;
      if (!txt?.deviceId) return;

      const peer: DiscoveredPeer = {
        device: {
          deviceId: txt.deviceId,
          deviceName: txt.deviceName || service.name,
          platform: (txt.platform as DeviceIdentity['platform']) || 'desktop-linux',
          capabilities: (txt.capabilities?.split(',') as DeviceIdentity['capabilities']) || ['lan-http'],
          publicKeyFingerprint: txt.fingerprint || '',
        },
        method: 'mdns',
        address: service.addresses?.[0] || service.host,
        httpPort: service.port,
        lastSeen: Date.now(),
        quality: 100,
      };

      this.peers.set(txt.deviceId, peer);
      for (const handler of this.peerHandlers) {
        handler(peer);
      }
    });

    this.browser.on('down', (service) => {
      const txt = service.txt as Record<string, string> | undefined;
      if (txt?.deviceId) {
        this.peers.delete(txt.deviceId);
        for (const handler of this.lostHandlers) {
          handler(txt.deviceId);
        }
      }
    });

    console.log('[mDNS] Started scanning for peers');
  }

  async stopScanning(): Promise<void> {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
  }

  onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void {
    this.peerHandlers.push(handler);
  }

  onPeerLost(handler: (deviceId: string) => void): void {
    this.lostHandlers.push(handler);
  }

  getKnownPeers(): DiscoveredPeer[] {
    return Array.from(this.peers.values());
  }

  destroy(): void {
    this.stopScanning();
    this.stopAnnouncing();
    this.bonjour.destroy();
  }
}
