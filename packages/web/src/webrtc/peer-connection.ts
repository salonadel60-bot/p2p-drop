/**
 * WebRTC Peer Connection manager for P2P file transfers.
 * Handles DataChannel creation, ICE negotiation, and data transfer.
 */

import type {
  ChunkMessage,
  ChunkAck,
  ProgressUpdate,
  TransferComplete,
  TransferError,
  HandshakeRequest,
  HandshakeResponse,
  DeviceIdentity,
} from '@p2p-drop/core';
import {
  serializeToJSON,
  deserializeFromJSON,
} from '@p2p-drop/core';
import type { RTCSignalingMessage } from './signaling.js';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const DATA_CHANNEL_OPTIONS: RTCDataChannelInit = {
  ordered: true,
};

const BINARY_CHANNEL_OPTIONS: RTCDataChannelInit = {
  ordered: true,
  maxRetransmits: 3,
};

export interface PeerConnectionEvents {
  onHandshakeRequest: (request: HandshakeRequest) => void;
  onHandshakeResponse: (response: HandshakeResponse) => void;
  onChunk: (chunk: ChunkMessage, data: ArrayBuffer) => void;
  onControl: (message: ChunkAck | ProgressUpdate | TransferComplete | TransferError) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: Error) => void;
}

/**
 * Manages a WebRTC peer connection for file transfer.
 */
export class WebRTCPeerConnection {
  private pc: RTCPeerConnection;
  private controlChannel: RTCDataChannel | null = null;
  private binaryChannel: RTCDataChannel | null = null;
  private _connected = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly localDevice: DeviceIdentity,
    private readonly peerId: string,
    private readonly isInitiator: boolean,
    private readonly events: PeerConnectionEvents,
    private readonly sendSignaling: (targetId: string, msg: RTCSignalingMessage) => void
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignaling(this.peerId, {
          type: 'ice-candidate',
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') {
        this._connected = true;
        this.events.onConnected();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this._connected = false;
        this.events.onDisconnected();
      }
    };

    if (this.isInitiator) {
      this.createDataChannels();
    } else {
      this.pc.ondatachannel = (ev) => {
        this.setupDataChannel(ev.channel);
      };
    }
  }

  get connected(): boolean { return this._connected; }

  /** Create offer (initiator) */
  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignaling(this.peerId, {
      type: 'offer',
      sdp: offer.sdp,
    });
  }

  /** Handle incoming signaling message */
  async handleSignaling(message: RTCSignalingMessage): Promise<void> {
    switch (message.type) {
      case 'offer': {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignaling(this.peerId, {
          type: 'answer',
          sdp: answer.sdp,
        });
        // Apply pending candidates
        for (const candidate of this.pendingCandidates) {
          await this.pc.addIceCandidate(candidate);
        }
        this.pendingCandidates = [];
        break;
      }
      case 'answer': {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        // Apply pending candidates
        for (const candidate of this.pendingCandidates) {
          await this.pc.addIceCandidate(candidate);
        }
        this.pendingCandidates = [];
        break;
      }
      case 'ice-candidate': {
        if (message.candidate) {
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(message.candidate);
          } else {
            this.pendingCandidates.push(message.candidate);
          }
        }
        break;
      }
    }
  }

  /** Send a handshake request */
  sendHandshakeRequest(request: HandshakeRequest): void {
    this.sendControlMessage(serializeToJSON(request));
  }

  /** Send a handshake response */
  sendHandshakeResponse(response: HandshakeResponse): void {
    this.sendControlMessage(serializeToJSON(response));
  }

  /** Send a file chunk via the binary data channel */
  sendChunk(chunk: ChunkMessage, data: ArrayBuffer): void {
    if (!this.binaryChannel || this.binaryChannel.readyState !== 'open') {
      throw new Error('Binary channel not open');
    }

    // Send chunk metadata first
    const meta = { ...chunk };
    delete (meta as Record<string, unknown>).data;
    this.binaryChannel.send(JSON.stringify(meta));

    // Then send binary data
    this.binaryChannel.send(data);
  }

  /** Send a control message (ack, progress, etc.) */
  sendControlMsg(message: ChunkAck | ProgressUpdate | TransferComplete | TransferError): void {
    this.sendControlMessage(JSON.stringify(message));
  }

  /** Close the connection */
  close(): void {
    this.controlChannel?.close();
    this.binaryChannel?.close();
    this.pc.close();
    this._connected = false;
  }

  private createDataChannels(): void {
    this.controlChannel = this.pc.createDataChannel('control', DATA_CHANNEL_OPTIONS);
    this.binaryChannel = this.pc.createDataChannel('binary', BINARY_CHANNEL_OPTIONS);
    this.setupDataChannel(this.controlChannel);
    this.setupDataChannel(this.binaryChannel);
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    if (channel.label === 'control') {
      this.controlChannel = channel;
      channel.onmessage = (ev) => this.handleControlMessage(ev.data as string);
    } else if (channel.label === 'binary') {
      this.binaryChannel = channel;
      channel.binaryType = 'arraybuffer';
      let pendingChunkMeta: ChunkMessage | null = null;
      channel.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          // This is chunk metadata
          pendingChunkMeta = JSON.parse(ev.data) as ChunkMessage;
        } else if (ev.data instanceof ArrayBuffer && pendingChunkMeta) {
          // This is the binary data
          this.events.onChunk(pendingChunkMeta, ev.data);
          pendingChunkMeta = null;
        }
      };
    }

    channel.onerror = (ev) => {
      this.events.onError(new Error(`DataChannel ${channel.label} error: ${ev}`));
    };
  }

  private sendControlMessage(data: string): void {
    if (!this.controlChannel || this.controlChannel.readyState !== 'open') {
      throw new Error('Control channel not open');
    }
    this.controlChannel.send(data);
  }

  private handleControlMessage(data: string): void {
    try {
      const message = deserializeFromJSON(data);
      switch (message.type) {
        case 'handshake-request':
          this.events.onHandshakeRequest(message);
          break;
        case 'handshake-response':
          this.events.onHandshakeResponse(message);
          break;
        case 'chunk-ack':
        case 'progress':
        case 'transfer-complete':
        case 'transfer-error':
          this.events.onControl(message);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }
}
