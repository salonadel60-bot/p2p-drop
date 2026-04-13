/**
 * Lightweight in-browser signaling for WebRTC peer discovery.
 * Uses BroadcastChannel for same-origin tabs, and an optional
 * lightweight WebSocket signaling server for cross-network.
 */

import type { DeviceIdentity } from '@p2p-drop/core';

export interface SignalingEvents {
  onPeerJoined: (peer: DeviceIdentity, peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
  onSignalingMessage: (from: string, message: RTCSignalingMessage) => void;
}

export interface RTCSignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  fileTransferId?: string;
}

interface SignalEnvelope {
  action: 'announce' | 'leave' | 'signal';
  senderId: string;
  senderDevice?: DeviceIdentity;
  targetId?: string;
  payload?: RTCSignalingMessage;
  timestamp: number;
}

/**
 * BroadcastChannel-based signaling for same-origin discovery.
 * Works across tabs on the same browser.
 */
export class LocalSignaling {
  private channel: BroadcastChannel;
  private peers = new Map<string, DeviceIdentity>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deviceId: string,
    private readonly device: DeviceIdentity,
    private readonly events: SignalingEvents
  ) {
    this.channel = new BroadcastChannel('p2p-drop-signaling');
    this.channel.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev.data as SignalEnvelope);
    };
  }

  start(): void {
    this.announce();
    this.heartbeatTimer = setInterval(() => this.announce(), 5000);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.sendEnvelope({ action: 'leave', senderId: this.deviceId, timestamp: Date.now() });
    this.channel.close();
  }

  sendSignaling(targetId: string, message: RTCSignalingMessage): void {
    this.sendEnvelope({
      action: 'signal',
      senderId: this.deviceId,
      targetId,
      payload: message,
      timestamp: Date.now(),
    });
  }

  private announce(): void {
    this.sendEnvelope({
      action: 'announce',
      senderId: this.deviceId,
      senderDevice: this.device,
      timestamp: Date.now(),
    });
  }

  private sendEnvelope(envelope: SignalEnvelope): void {
    this.channel.postMessage(envelope);
  }

  private handleMessage(envelope: SignalEnvelope): void {
    if (envelope.senderId === this.deviceId) return;

    switch (envelope.action) {
      case 'announce':
        if (envelope.senderDevice && !this.peers.has(envelope.senderId)) {
          this.peers.set(envelope.senderId, envelope.senderDevice);
          this.events.onPeerJoined(envelope.senderDevice, envelope.senderId);
          // Reply with our own announcement
          this.announce();
        }
        break;

      case 'leave':
        if (this.peers.has(envelope.senderId)) {
          this.peers.delete(envelope.senderId);
          this.events.onPeerLeft(envelope.senderId);
        }
        break;

      case 'signal':
        if (envelope.targetId === this.deviceId && envelope.payload) {
          this.events.onSignalingMessage(envelope.senderId, envelope.payload);
        }
        break;
    }
  }
}

/**
 * WebSocket-based signaling for cross-network discovery.
 * Connects to a lightweight signaling server.
 */
export class WebSocketSignaling {
  private ws: WebSocket | null = null;
  private peers = new Map<string, DeviceIdentity>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(
    private readonly deviceId: string,
    private readonly device: DeviceIdentity,
    private readonly serverUrl: string,
    private readonly events: SignalingEvents
  ) {}

  get connected(): boolean { return this._connected; }

  connect(): void {
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this._connected = true;
        this.announce();
      };

      this.ws.onmessage = (ev: MessageEvent) => {
        try {
          const envelope = JSON.parse(ev.data as string) as SignalEnvelope;
          this.handleMessage(envelope);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this._connected = false;
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.sendEnvelope({ action: 'leave', senderId: this.deviceId, timestamp: Date.now() });
      this.ws.close();
      this.ws = null;
    }
  }

  sendSignaling(targetId: string, message: RTCSignalingMessage): void {
    this.sendEnvelope({
      action: 'signal',
      senderId: this.deviceId,
      targetId,
      payload: message,
      timestamp: Date.now(),
    });
  }

  private announce(): void {
    this.sendEnvelope({
      action: 'announce',
      senderId: this.deviceId,
      senderDevice: this.device,
      timestamp: Date.now(),
    });
  }

  private sendEnvelope(envelope: SignalEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  private handleMessage(envelope: SignalEnvelope): void {
    if (envelope.senderId === this.deviceId) return;

    switch (envelope.action) {
      case 'announce':
        if (envelope.senderDevice) {
          const isNew = !this.peers.has(envelope.senderId);
          this.peers.set(envelope.senderId, envelope.senderDevice);
          if (isNew) {
            this.events.onPeerJoined(envelope.senderDevice, envelope.senderId);
          }
        }
        break;

      case 'leave':
        if (this.peers.has(envelope.senderId)) {
          this.peers.delete(envelope.senderId);
          this.events.onPeerLeft(envelope.senderId);
        }
        break;

      case 'signal':
        if (envelope.targetId === this.deviceId && envelope.payload) {
          this.events.onSignalingMessage(envelope.senderId, envelope.payload);
        }
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}
