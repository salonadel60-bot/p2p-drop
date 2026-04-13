/**
 * P2P Drop Web Application - Main entry point.
 * Coordinates WebRTC connections, file transfer, and UI.
 */

import {
  type DeviceIdentity,
  type FileMetadata,
  type HandshakeRequest,
  type HandshakeResponse,
  type TransferState,
  PROTOCOL_VERSION,
  getOrCreateIdentity,
  SessionStorageAdapter,
  generateSessionKeyPair,
  computeOptimalChunkSize,
  createFileMetadata,
  FileSender,
  FileReceiver,
  generatePairingInfo,
  parsePairingURL,
  parseQRData,
} from '@p2p-drop/core';

import {
  LocalSignaling,
  WebSocketSignaling,
  WebRTCPeerConnection,
  WebRTCTransport,
} from './webrtc/index.js';
import type { RTCSignalingMessage } from './webrtc/index.js';
import { BrowserFileSource, BrowserFileSink, computeFileSHA256 } from './ui/file-handler.js';
import { renderUI, updatePeerList, updateTransferProgress, showNotification, addTransferEntry, updateTransferState, updateMediaRoom, showActionRequest, setPairingLink, addChatMessage } from './ui/renderer.js';

interface PeerState {
  device: DeviceIdentity;
  connection: WebRTCPeerConnection | null;
  transport: WebRTCTransport | null;
}

class P2PDropApp {
  private identity!: DeviceIdentity;
  private localSignaling: LocalSignaling | null = null;
  private wsSignaling: WebSocketSignaling | null = null;
  private peers = new Map<string, PeerState>();
  private activeTransfers = new Map<string, { sender?: FileSender; receiver?: FileReceiver; sink?: BrowserFileSink }>();
  private mediaConnections = new Map<string, RTCPeerConnection>();
  private localMediaStream: MediaStream | null = null;
  private remoteMediaStreams = new Map<string, MediaStream>();
  private mediaMode: 'voice' | 'video' | 'screen' | null = null;
  private activeMediaPeerId: string | null = null;
  private pendingConnectionResponses = new Map<string, (accepted: boolean) => void>();
  private pendingMediaResponses = new Map<string, (accepted: boolean) => void>();
  private browserClientId = this.getBrowserClientId();

  async init(): Promise<void> {
    // Get or create device identity
    this.identity = await getOrCreateIdentity(new SessionStorageAdapter());

    // Render the UI
    renderUI(this.identity, {
      onFilesSelected: (files, peerId) => this.sendFiles(files, peerId),
      onPeerClick: (peerId) => this.connectToPeer(peerId),
      onQRScanned: (data) => this.handleQRScanned(data),
      onStartMedia: (peerId, mode) => void this.startMedia(peerId, mode),
      onStopMedia: (peerId) => this.stopMedia(peerId),
      onSendChat: (peerId, text) => this.sendChatMessage(peerId, text),
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('localTabs') === '1') {
      this.localSignaling = new LocalSignaling(
        this.identity.deviceId,
        this.identity,
        {
          onPeerJoined: (device, peerId) => this.handlePeerJoined(device, peerId),
          onPeerLeft: (peerId) => this.handlePeerLeft(peerId),
          onSignalingMessage: (from, msg) => this.handleSignalingMessage(from, msg),
        }
      );
      this.localSignaling.start();
    }

    // Try WebSocket signaling if available
    this.tryWebSocketSignaling();

    // Set up pairing URL display
    this.setupPairing();

    console.log('[P2P Drop] Initialized', this.identity);
  }

  private tryWebSocketSignaling(): void {
    const params = new URLSearchParams(window.location.search);
    this.connectToSignalingServer(params.get('signaling') ?? this.getSignalingURL(), false);
  }

  private getSignalingURL(): string {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('signaling');
    if (fromParam) return fromParam;

    const url = new URL('/signaling', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('room', 'public');
    return url.toString();
  }

  private connectToSignalingServer(signalingUrl: string, notify: boolean): void {
    const normalizedUrl = this.normalizeSignalingURL(signalingUrl);
    if (this.wsSignaling?.url === normalizedUrl) {
      if (this.wsSignaling.connected) {
        this.wsSignaling.refresh();
        if (notify) showNotification('Refreshing live device discovery...', 'info');
      } else {
        this.wsSignaling.connect();
        if (notify) showNotification('Reconnecting to live device discovery...', 'info');
      }
      return;
    }

    this.wsSignaling?.disconnect();
    this.wsSignaling = new WebSocketSignaling(
      this.identity.deviceId,
      this.identity,
      normalizedUrl,
      this.browserClientId,
      {
        onPeerJoined: (device, peerId) => this.handlePeerJoined(device, peerId),
        onPeerLeft: (peerId) => this.handlePeerLeft(peerId),
        onSignalingMessage: (from, msg) => this.handleSignalingMessage(from, msg),
        onConnectionStateChange: (connected) => {
          console.log(`[P2P Drop] Live signaling ${connected ? 'connected' : 'disconnected'}: ${normalizedUrl}`);
          if (notify) {
            showNotification(
              connected ? 'Live device discovery connected' : 'Live device discovery disconnected — retrying...',
              connected ? 'success' : 'warning'
            );
          }
        },
      }
    );
    this.wsSignaling.connect();
  }

  private normalizeSignalingURL(value: string): string {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!url.searchParams.has('room')) url.searchParams.set('room', 'public');
    return url.toString();
  }

  private getBrowserClientId(): string {
    const key = 'p2p-drop-browser-client-id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(key, value);
    }
    return value;
  }

  private setupPairing(): void {
    const signalingUrl = this.getSignalingURL();
    const pairingInfo = generatePairingInfo(
      this.identity,
      signalingUrl,
      30
    );
    const payload = {
      p2pd: 1,
      d: pairingInfo.device.deviceId,
      n: pairingInfo.device.deviceName,
      e: signalingUrl,
      c: pairingInfo.pairingCode,
      x: pairingInfo.expiresAt,
    };
    const encoded = this.encodePairingPayload(payload);
    const pairingURL = `${window.location.origin}${window.location.pathname}#p=${encoded}`;

    // Display pairing URL in the UI
    const pairingElement = document.getElementById('pairing-url');
    if (pairingElement) {
      setPairingLink(pairingURL, this.shortenPairingURL(pairingURL));
    }

    this.generateQRCode(`p2pd:${encoded}`);
  }

  private async generateQRCode(data: string): Promise<void> {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    try {
      const QRCode = await import('qrcode');
      await QRCode.toCanvas(canvas, data, {
        width: 260,
        scale: 10,
        margin: 3,
        errorCorrectionLevel: 'M',
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
    } catch {
      console.warn('[P2P Drop] QR code generation not available');
    }
  }

  private handleQRScanned(raw: string): void {
    // Try compact QR data format first (p2pd JSON)
    let parsed = this.parseCompactPairing(raw) ?? parseQRData(raw);
    if (!parsed) {
      // Try URL format (#pair=base64)
      const fromURL = parsePairingURL(raw);
      if (fromURL) {
        parsed = {
          deviceId: fromURL.device.deviceId,
          deviceName: fromURL.device.deviceName,
          endpoint: fromURL.endpoint,
          pairingCode: fromURL.pairingCode,
          expiresAt: fromURL.expiresAt,
        };
      }
    }

    if (!parsed) {
      showNotification('Invalid QR code — not a P2P Drop code', 'error');
      return;
    }

    // Check expiry
    if (new Date(parsed.expiresAt) < new Date()) {
      showNotification('QR code has expired — ask the other device to refresh', 'warning');
      return;
    }

    // The endpoint field now contains the signaling server URL
    const signalingUrl = parsed.endpoint;
    showNotification(`Connecting to ${parsed.deviceName}...`, 'info');
    console.log('[P2P Drop] QR scanned, connecting via', signalingUrl);

    if (parsed.deviceId === this.identity.deviceId) {
      showNotification('This is your own QR code — scan the code on the other device', 'warning');
      return;
    }

    this.connectToSignalingServer(signalingUrl, true);
  }

  private encodePairingPayload(payload: { p2pd: number; d: string; n: string; e: string; c: string; x: string }): string {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private shortenPairingURL(pairingURL: string): string {
    const hashIndex = pairingURL.indexOf('#p=');
    if (hashIndex === -1) return pairingURL;
    const prefix = pairingURL.slice(0, Math.min(hashIndex + 3, 34));
    const token = pairingURL.slice(hashIndex + 3);
    return `${prefix}${token.slice(0, 8)}…${token.slice(-6)}`;
  }

  private parseCompactPairing(raw: string): { deviceId: string; deviceName: string; endpoint: string; pairingCode: string; expiresAt: string } | null {
    const value = raw.startsWith('p2pd:')
      ? raw.slice(5)
      : raw.includes('#p=')
        ? raw.split('#p=')[1]
        : '';
    if (!value) return null;
    try {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
      const bytes = Uint8Array.from(atob(normalized), char => char.charCodeAt(0));
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { p2pd?: number; d?: string; n?: string; e?: string; c?: string; x?: string };
      if (parsed.p2pd !== 1 || !parsed.d || !parsed.e || !parsed.c || !parsed.x) return null;
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

  private handlePeerJoined(device: DeviceIdentity, peerId: string): void {
    if (this.peers.has(peerId)) return;

    this.peers.set(peerId, {
      device,
      connection: null,
      transport: null,
    });

    updatePeerList(Array.from(this.peers.entries()).map(([id, state]) => ({
      id,
      device: state.device,
      connected: state.connection?.connected ?? false,
    })));

    showNotification(`${device.deviceName} joined`, 'info');
    console.log('[P2P Drop] Peer joined:', device.deviceName);
  }

  private handlePeerLeft(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connection?.close();
      this.peers.delete(peerId);
      updatePeerList(Array.from(this.peers.entries()).map(([id, state]) => ({
        id,
        device: state.device,
        connected: state.connection?.connected ?? false,
      })));
      showNotification(`${peer.device.deviceName} left`, 'info');
    }
  }

  private async handleSignalingMessage(from: string, msg: RTCSignalingMessage): Promise<void> {
    if (msg.type === 'connection-request') {
      await this.handleConnectionRequest(from, msg);
      return;
    }

    if (msg.type === 'connection-response') {
      this.handleConnectionResponse(msg);
      return;
    }

    if (msg.type === 'media-request') {
      await this.handleMediaRequest(from, msg);
      return;
    }

    if (msg.type === 'media-response') {
      this.handleMediaResponse(msg);
      return;
    }

    if (msg.type === 'media-stop') {
      this.handleRemoteMediaStop(from);
      return;
    }

    if (msg.type === 'chat-message') {
      this.handleIncomingChat(from, msg);
      return;
    }

    if (msg.fileTransferId === 'media') {
      await this.handleMediaSignaling(from, msg);
      return;
    }

    let peer = this.peers.get(from);

    // If we receive an offer from an unknown peer, we need to create the connection
    if (!peer) return;

    if (!peer.connection) {
      this.createPeerConnection(from, false);
      peer = this.peers.get(from)!;
    }

    await peer.connection!.handleSignaling(msg);
  }

  private createPeerConnection(peerId: string, isInitiator: boolean): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const sendSignaling = (targetId: string, msg: RTCSignalingMessage) => {
      this.localSignaling?.sendSignaling(targetId, msg);
      this.wsSignaling?.sendSignaling(targetId, msg);
    };

    // Use a shared transport reference that both the connection callbacks
    // and the peer state point to, so incoming events reach FileSender/FileReceiver.
    let sharedTransport: WebRTCTransport | null = null;

    const connection = new WebRTCPeerConnection(
      this.identity,
      peerId,
      isInitiator,
      {
        onHandshakeRequest: (req) => this.handleHandshakeRequest(peerId, req),
        onHandshakeResponse: (res) => this.handleHandshakeResponse(peerId, res),
        onChunk: (chunk, data) => sharedTransport?.handleIncomingChunk(chunk, data),
        onControl: (msg) => sharedTransport?.handleIncomingControl(msg),
        onConnected: () => {
          showNotification(`Connected to ${peer.device.deviceName}`, 'success');
          updatePeerList(Array.from(this.peers.entries()).map(([id, state]) => ({
            id,
            device: state.device,
            connected: state.connection?.connected ?? false,
          })));
        },
        onDisconnected: () => {
          showNotification(`Disconnected from ${peer.device.deviceName}`, 'warning');
        },
        onError: (err) => {
          console.error('[P2P Drop] Connection error:', err);
        },
      },
      sendSignaling
    );

    // Create the single transport instance bound to the real connection
    sharedTransport = new WebRTCTransport(connection);
    peer.connection = connection;
    peer.transport = sharedTransport;
  }

  private async connectToPeer(peerId: string): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    if (peer.connection?.connected) {
      showNotification(`Already connected to ${peer.device.deviceName}`, 'info');
      return true;
    }

    const accepted = await this.requestPeerConnection(peerId);
    if (!accepted) {
      showNotification(`${peer.device.deviceName} rejected the connection request`, 'warning');
      return false;
    }

    if (!peer.connection) {
      this.createPeerConnection(peerId, true);
    }

    await peer.connection!.createOffer();
    return true;
  }

  private async requestPeerConnection(peerId: string): Promise<boolean> {
    const requestId = crypto.randomUUID();
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    const accepted = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        this.pendingConnectionResponses.delete(requestId);
        resolve(false);
      }, 30000);
      this.pendingConnectionResponses.set(requestId, (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      });
      this.sendConnectionSignal(peerId, { type: 'connection-request', requestId });
    });

    return accepted;
  }

  private async handleConnectionRequest(peerId: string, msg: RTCSignalingMessage): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !msg.requestId) return;

    const accepted = await showActionRequest(
      'طلب اتصال',
      `${peer.device.deviceName} يريد الاتصال بجهازك. هل تريد القبول؟`,
      'قبول',
      'رفض'
    );

    this.sendConnectionSignal(peerId, {
      type: 'connection-response',
      requestId: msg.requestId,
      accepted,
      reason: accepted ? undefined : 'rejected',
    });
  }

  private handleConnectionResponse(msg: RTCSignalingMessage): void {
    if (!msg.requestId) return;
    const resolver = this.pendingConnectionResponses.get(msg.requestId);
    if (!resolver) return;
    this.pendingConnectionResponses.delete(msg.requestId);
    resolver(Boolean(msg.accepted));
  }

  private sendConnectionSignal(peerId: string, msg: RTCSignalingMessage): void {
    this.localSignaling?.sendSignaling(peerId, msg);
    this.wsSignaling?.sendSignaling(peerId, msg);
  }

  private sendChatMessage(peerId: string, text: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      showNotification('Select a peer first', 'error');
      return;
    }

    this.localSignaling?.sendSignaling(peerId, {
      type: 'chat-message',
      text,
      messageId: crypto.randomUUID(),
      senderName: this.identity.deviceName,
    });
    this.wsSignaling?.sendSignaling(peerId, {
      type: 'chat-message',
      text,
      messageId: crypto.randomUUID(),
      senderName: this.identity.deviceName,
    });
  }

  private handleIncomingChat(peerId: string, msg: RTCSignalingMessage): void {
    const text = msg.text?.trim();
    if (!text) return;
    const peer = this.peers.get(peerId);
    const senderName = msg.senderName ?? peer?.device.deviceName ?? 'Peer';
    addChatMessage(peerId, text, 'received', senderName);
    showNotification(`New message from ${senderName}`, 'info');
  }

  private async startMedia(peerId: string, mode: 'voice' | 'video' | 'screen'): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      showNotification('Select a peer first', 'error');
      return;
    }

    try {
      if (!peer.connection?.connected) {
        const connected = await this.connectToPeer(peerId);
        if (!connected) return;
        await this.waitForPeerConnection(peer);
      }

      if (!peer.connection?.connected) {
        showNotification('Could not connect to peer', 'error');
        return;
      }

      this.closeLocalMedia(peerId);
      this.localMediaStream = await this.requestMediaStream(mode);
      this.mediaMode = mode;
      this.activeMediaPeerId = peerId;
      updateMediaRoom(this.localMediaStream, this.remoteMediaStreams.get(peerId) ?? null, mode, peer.device.deviceName, peerId);

      const accepted = await this.requestMediaPermission(peerId, mode);
      if (!accepted) {
        this.closeLocalMedia(peerId);
        updateMediaRoom(null, null, null, peer.device.deviceName, peerId);
        showNotification(`${peer.device.deviceName} rejected the ${mode} call`, 'warning');
        return;
      }

      const pc = this.ensureMediaConnection(peerId);
      this.addLocalTracksToMediaConnection(pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendMediaSignal(peerId, { type: 'offer', sdp: offer.sdp, fileTransferId: 'media' });
      updateMediaRoom(this.localMediaStream, this.remoteMediaStreams.get(peerId) ?? null, mode, peer.device.deviceName, peerId);
    } catch (error) {
      this.closeLocalMedia(peerId);
      showNotification(this.getMediaErrorMessage(error, mode), 'error');
      console.warn('[P2P Drop] Media start failed:', error);
    }
  }

  private stopMedia(peerId: string): void {
    this.sendMediaSignal(peerId, { type: 'media-stop' });
    this.closeLocalMedia(peerId);
    updateMediaRoom(null, null, null, this.peers.get(peerId)?.device.deviceName ?? '', peerId);
  }

  private closeLocalMedia(peerId: string): void {
    this.localMediaStream?.getTracks().forEach(track => track.stop());
    this.localMediaStream = null;
    this.mediaMode = null;
    if (this.activeMediaPeerId === peerId) {
      this.activeMediaPeerId = null;
    }
    this.mediaConnections.get(peerId)?.close();
    this.mediaConnections.delete(peerId);
    this.remoteMediaStreams.delete(peerId);
  }

  private async waitForPeerConnection(peer: PeerState): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = window.setInterval(() => {
        if (peer.connection?.connected) {
          window.clearInterval(check);
          resolve();
        }
      }, 100);
      window.setTimeout(() => {
        window.clearInterval(check);
        resolve();
      }, 10000);
    });
  }

  private async requestMediaStream(mode: 'voice' | 'video' | 'screen'): Promise<MediaStream> {
    if (!navigator.mediaDevices) {
      throw new Error('media-devices-unavailable');
    }

    if (mode === 'screen') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error('screen-share-unavailable');
      }
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }

    if (mode === 'voice') {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw error;
    }
  }

  private getMediaErrorMessage(error: unknown, mode: 'voice' | 'video' | 'screen'): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return 'Camera/microphone permission was blocked. Allow access from the browser and try again.';
      }
      if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
        if (mode === 'voice') return 'No microphone was found on this device.';
        if (mode === 'video') return 'No camera was found on this device.';
        return 'Screen sharing is not available on this device.';
      }
      if (error.name === 'NotReadableError') {
        return 'The camera or microphone is already being used by another app.';
      }
    }

    if (error instanceof Error && error.message === 'screen-share-unavailable') {
      return 'Screen sharing is not supported in this browser.';
    }

    return 'Could not start media. Check your camera/microphone and browser permissions.';
  }

  private ensureMediaConnection(peerId: string): RTCPeerConnection {
    const existing = this.mediaConnections.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMediaSignal(peerId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
          fileTransferId: 'media',
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = this.remoteMediaStreams.get(peerId) ?? new MediaStream();
      if (!stream.getTracks().some(track => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      this.remoteMediaStreams.set(peerId, stream);
      updateMediaRoom(this.localMediaStream, stream, this.mediaMode, this.peers.get(peerId)?.device.deviceName ?? '', peerId);
    };

    this.mediaConnections.set(peerId, pc);
    return pc;
  }

  private async handleMediaSignaling(peerId: string, msg: RTCSignalingMessage): Promise<void> {
    const pc = this.ensureMediaConnection(peerId);
    if (msg.type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      this.addLocalTracksToMediaConnection(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendMediaSignal(peerId, { type: 'answer', sdp: answer.sdp, fileTransferId: 'media' });
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await pc.addIceCandidate(msg.candidate);
    }
  }

  private async requestMediaPermission(peerId: string, mode: 'voice' | 'video' | 'screen'): Promise<boolean> {
    const requestId = crypto.randomUUID();

    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        this.pendingMediaResponses.delete(requestId);
        resolve(false);
      }, 45000);
      this.pendingMediaResponses.set(requestId, (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      });
      this.sendMediaSignal(peerId, { type: 'media-request', requestId, mode });
    });
  }

  private async handleMediaRequest(peerId: string, msg: RTCSignalingMessage): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !msg.requestId || !msg.mode) return;

    const accepted = await showActionRequest(
      'طلب مكالمة',
      `${peer.device.deviceName} يريد بدء ${this.getMediaModeLabel(msg.mode)}. هل تريد القبول؟`,
      'قبول',
      'رفض'
    );

    if (!accepted) {
      this.sendMediaSignal(peerId, { type: 'media-response', requestId: msg.requestId, accepted: false, mode: msg.mode, reason: 'rejected' });
      return;
    }

    try {
      this.closeLocalMedia(peerId);
      this.localMediaStream = await this.requestMediaStream(msg.mode);
      this.mediaMode = msg.mode;
      this.activeMediaPeerId = peerId;
      updateMediaRoom(this.localMediaStream, null, msg.mode, peer.device.deviceName, peerId);
      this.sendMediaSignal(peerId, { type: 'media-response', requestId: msg.requestId, accepted: true, mode: msg.mode });
    } catch (error) {
      this.closeLocalMedia(peerId);
      this.sendMediaSignal(peerId, { type: 'media-response', requestId: msg.requestId, accepted: false, mode: msg.mode, reason: 'media-unavailable' });
      showNotification(this.getMediaErrorMessage(error, msg.mode), 'error');
    }
  }

  private handleMediaResponse(msg: RTCSignalingMessage): void {
    if (!msg.requestId) return;
    const resolver = this.pendingMediaResponses.get(msg.requestId);
    if (!resolver) return;
    this.pendingMediaResponses.delete(msg.requestId);
    resolver(Boolean(msg.accepted));
  }

  private handleRemoteMediaStop(peerId: string): void {
    const peerName = this.peers.get(peerId)?.device.deviceName ?? '';
    this.closeLocalMedia(peerId);
    updateMediaRoom(null, null, null, peerName, peerId);
    showNotification(`${peerName} ended the call`, 'info');
  }

  private addLocalTracksToMediaConnection(pc: RTCPeerConnection): void {
    if (!this.localMediaStream) return;
    const senderTrackIds = new Set(pc.getSenders().map(sender => sender.track?.id).filter(Boolean));
    for (const track of this.localMediaStream.getTracks()) {
      if (!senderTrackIds.has(track.id)) {
        pc.addTrack(track, this.localMediaStream);
      }
    }
  }

  private getMediaModeLabel(mode: 'voice' | 'video' | 'screen'): string {
    if (mode === 'voice') return 'مكالمة صوتية';
    if (mode === 'screen') return 'مشاركة شاشة';
    return 'مكالمة فيديو';
  }

  private sendMediaSignal(peerId: string, msg: RTCSignalingMessage): void {
    this.localSignaling?.sendSignaling(peerId, msg);
    this.wsSignaling?.sendSignaling(peerId, msg);
  }

  private async sendFiles(files: FileList | File[], peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      showNotification('Select a peer first', 'error');
      return;
    }

    // Ensure connection exists
    if (!peer.connection || !peer.connection.connected) {
      const connected = await this.connectToPeer(peerId);
      if (!connected) return;
      // Wait for connection
      await this.waitForPeerConnection(peer);
    }

    if (!peer.connection?.connected) {
      showNotification('Could not connect to peer', 'error');
      return;
    }

    const keyPair = await generateSessionKeyPair();
    const fileMetadataList: FileMetadata[] = [];

    for (const file of Array.from(files)) {
      const sha256Hash = await computeFileSHA256(file);
      const chunkSize = computeOptimalChunkSize(file.size);
      const metadata = createFileMetadata(file.name, file.size, file.type || 'application/octet-stream', sha256Hash, chunkSize);
      fileMetadataList.push(metadata);
    }

    // Send handshake request
    const request: HandshakeRequest = {
      type: 'handshake-request',
      version: PROTOCOL_VERSION,
      sender: this.identity,
      files: fileMetadataList,
      sessionPublicKey: keyPair.publicKeyBase64,
      timestamp: new Date().toISOString(),
    };

    peer.connection.sendHandshakeRequest(request);

    // Store file data for when handshake is accepted
    const fileMap = new Map<string, File>();
    for (let i = 0; i < fileMetadataList.length; i++) {
      fileMap.set(fileMetadataList[i].fileId, Array.from(files)[i]);
    }

    // Store pending transfer info
    (peer as unknown as Record<string, unknown>)._pendingFiles = fileMap;
    (peer as unknown as Record<string, unknown>)._pendingMetadata = fileMetadataList;
  }

  private handleHandshakeRequest(peerId: string, request: HandshakeRequest): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Auto-accept for now (in production, show a confirmation dialog)
    const totalSize = request.files.reduce((sum, f) => sum + f.fileSize, 0);
    const fileNames = request.files.map(f => f.fileName).join(', ');

    showNotification(
      `${request.sender.deviceName} wants to send: ${fileNames} (${formatSize(totalSize)})`,
      'info'
    );

    // Accept all files
    const response: HandshakeResponse = {
      type: 'handshake-response',
      accepted: true,
      receiver: this.identity,
      acceptedFileIds: request.files.map(f => f.fileId),
      selectedTransport: 'webrtc',
      sessionPublicKey: '',  // Will be set properly with crypto
      timestamp: new Date().toISOString(),
    };

    peer.connection!.sendHandshakeResponse(response);

    // Set up receivers for each file
    for (const fileMeta of request.files) {
      const sink = new BrowserFileSink(fileMeta.fileName, fileMeta.fileSize, fileMeta.mimeType);
      const transport = peer.transport!;

      const receiver = new FileReceiver(fileMeta, sink, transport, {
        onProgress: (update) => {
          updateTransferProgress(fileMeta.fileId, update);
        },
        onComplete: () => {
          updateTransferState(fileMeta.fileId, 'completed');
          showNotification(`Received: ${fileMeta.fileName}`, 'success');
          // Auto-download
          sink.downloadFile();
        },
        onError: (error) => {
          updateTransferState(fileMeta.fileId, 'failed');
          showNotification(`Error receiving ${fileMeta.fileName}: ${error.message}`, 'error');
        },
        onStateChange: (fileId, state) => {
          updateTransferState(fileId, state);
        },
      });

      receiver.startReceiving();
      this.activeTransfers.set(fileMeta.fileId, { receiver, sink });
      addTransferEntry(fileMeta, 'receive', request.sender.deviceName);
    }
  }

  private async handleHandshakeResponse(peerId: string, response: HandshakeResponse): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (!response.accepted) {
      showNotification(`${response.receiver.deviceName} rejected the transfer`, 'error');
      return;
    }

    const pendingFiles = (peer as unknown as Record<string, unknown>)._pendingFiles as Map<string, File> | undefined;
    const pendingMetadata = (peer as unknown as Record<string, unknown>)._pendingMetadata as FileMetadata[] | undefined;
    if (!pendingFiles || !pendingMetadata) return;

    // Start sending accepted files
    for (const fileId of response.acceptedFileIds) {
      const file = pendingFiles.get(fileId);
      const metadata = pendingMetadata.find(m => m.fileId === fileId);
      if (!file || !metadata) continue;

      const source = new BrowserFileSource(file);
      const transport = peer.transport!;

      const sender = new FileSender(metadata, source, transport, {
        onProgress: (update) => {
          updateTransferProgress(metadata.fileId, update);
        },
        onComplete: () => {
          updateTransferState(metadata.fileId, 'completed');
          showNotification(`Sent: ${metadata.fileName}`, 'success');
        },
        onError: (error) => {
          updateTransferState(metadata.fileId, 'failed');
          showNotification(`Error sending ${metadata.fileName}: ${error.message}`, 'error');
        },
        onStateChange: (fId: string, state: TransferState) => {
          updateTransferState(fId, state);
        },
      });

      this.activeTransfers.set(fileId, { sender });
      addTransferEntry(metadata, 'send', response.receiver.deviceName);
      sender.send();
    }

    // Clean up pending state
    delete (peer as unknown as Record<string, unknown>)._pendingFiles;
    delete (peer as unknown as Record<string, unknown>)._pendingMetadata;
  }

  destroy(): void {
    this.localSignaling?.stop();
    this.wsSignaling?.disconnect();
    for (const peer of this.peers.values()) {
      peer.connection?.close();
    }
    this.peers.clear();
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Boot the app
const app = new P2PDropApp();
app.init().catch(console.error);

// Export for use in dev console
(window as unknown as Record<string, unknown>).p2pDrop = app;

export { P2PDropApp, formatSize };
