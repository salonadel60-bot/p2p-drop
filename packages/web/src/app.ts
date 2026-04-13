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
import { renderUI, updatePeerList, updateTransferProgress, showNotification, addTransferEntry, updateTransferState, updateMediaRoom } from './ui/renderer.js';

interface PeerState {
  device: DeviceIdentity;
  connection: WebRTCPeerConnection | null;
  transport: WebRTCTransport | null;
}

class P2PDropApp {
  private identity!: DeviceIdentity;
  private localSignaling!: LocalSignaling;
  private wsSignaling: WebSocketSignaling | null = null;
  private peers = new Map<string, PeerState>();
  private activeTransfers = new Map<string, { sender?: FileSender; receiver?: FileReceiver; sink?: BrowserFileSink }>();
  private mediaConnections = new Map<string, RTCPeerConnection>();
  private localMediaStream: MediaStream | null = null;
  private remoteMediaStreams = new Map<string, MediaStream>();
  private mediaMode: 'voice' | 'video' | 'screen' | null = null;

  async init(): Promise<void> {
    // Get or create device identity
    this.identity = await getOrCreateIdentity(new SessionStorageAdapter());

    // Render the UI
    renderUI(this.identity, {
      onFilesSelected: (files, peerId) => this.sendFiles(files, peerId),
      onPeerClick: (peerId) => this.connectToPeer(peerId),
      onQRScanned: (data) => this.handleQRScanned(data),
      onStartMedia: (peerId, mode) => this.startMedia(peerId, mode),
      onStopMedia: (peerId) => this.stopMedia(peerId),
    });

    // Start local signaling (BroadcastChannel for same-origin tabs)
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

    // Try WebSocket signaling if available
    this.tryWebSocketSignaling();

    // Set up pairing URL display
    this.setupPairing();

    console.log('[P2P Drop] Initialized', this.identity);
  }

  private tryWebSocketSignaling(): void {
    // Check for signaling server URL in URL params
    const params = new URLSearchParams(window.location.search);
    const signalingUrl = params.get('signaling');
    if (signalingUrl) {
      this.wsSignaling = new WebSocketSignaling(
        this.identity.deviceId,
        this.identity,
        signalingUrl,
        {
          onPeerJoined: (device, peerId) => this.handlePeerJoined(device, peerId),
          onPeerLeft: (peerId) => this.handlePeerLeft(peerId),
          onSignalingMessage: (from, msg) => this.handleSignalingMessage(from, msg),
        }
      );
      this.wsSignaling.connect();
    }
  }

  private getSignalingURL(): string {
    // 1. Explicit override via URL param
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('signaling');
    if (fromParam) return fromParam;

    // 2. Derive from current page URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;

    // Local development
    if (host === 'localhost' || host === '127.0.0.1') {
      return `ws://localhost:3001`;
    }

    // Deployed (Replit, Vercel, etc.) — signaling on port 3001 same host
    return `${proto}//${host}:3001`;
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
      pairingElement.textContent = pairingURL;
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

    // If already connected to the same signaling server, skip reconnect
    if (this.wsSignaling) {
      showNotification(`Already on a signaling network — device should appear on radar`, 'info');
      return;
    }

    // Connect to the signaling server from the QR code
    this.wsSignaling = new WebSocketSignaling(
      this.identity.deviceId,
      this.identity,
      signalingUrl,
      {
        onPeerJoined: (device, peerId) => this.handlePeerJoined(device, peerId),
        onPeerLeft: (peerId) => this.handlePeerLeft(peerId),
        onSignalingMessage: (from, msg) => this.handleSignalingMessage(from, msg),
      }
    );
    this.wsSignaling.connect();
    showNotification(`Joined network — ${parsed.deviceName} should appear on radar`, 'success');
  }

  private encodePairingPayload(payload: { p2pd: number; d: string; n: string; e: string; c: string; x: string }): string {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
      this.localSignaling.sendSignaling(targetId, msg);
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

  private async connectToPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (!peer.connection) {
      this.createPeerConnection(peerId, true);
    }

    await peer.connection!.createOffer();
  }

  private async startMedia(peerId: string, mode: 'voice' | 'video' | 'screen'): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      showNotification('Select a peer first', 'error');
      return;
    }

    this.localMediaStream?.getTracks().forEach(track => track.stop());
    this.localMediaStream = mode === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: mode === 'video', audio: true });
    this.mediaMode = mode;

    const pc = this.ensureMediaConnection(peerId);
    this.localMediaStream.getTracks().forEach(track => pc.addTrack(track, this.localMediaStream!));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendMediaSignal(peerId, { type: 'offer', sdp: offer.sdp, fileTransferId: 'media' });
    updateMediaRoom(this.localMediaStream, this.remoteMediaStreams.get(peerId) ?? null, mode, peer.device.deviceName);
  }

  private stopMedia(peerId: string): void {
    this.localMediaStream?.getTracks().forEach(track => track.stop());
    this.localMediaStream = null;
    this.mediaMode = null;
    this.mediaConnections.get(peerId)?.close();
    this.mediaConnections.delete(peerId);
    this.remoteMediaStreams.delete(peerId);
    updateMediaRoom(null, null, null, this.peers.get(peerId)?.device.deviceName ?? '');
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
      stream.addTrack(event.track);
      this.remoteMediaStreams.set(peerId, stream);
      updateMediaRoom(this.localMediaStream, stream, this.mediaMode, this.peers.get(peerId)?.device.deviceName ?? '');
    };

    this.mediaConnections.set(peerId, pc);
    return pc;
  }

  private async handleMediaSignaling(peerId: string, msg: RTCSignalingMessage): Promise<void> {
    const pc = this.ensureMediaConnection(peerId);
    if (msg.type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      this.localMediaStream?.getTracks().forEach(track => pc.addTrack(track, this.localMediaStream!));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendMediaSignal(peerId, { type: 'answer', sdp: answer.sdp, fileTransferId: 'media' });
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await pc.addIceCandidate(msg.candidate);
    }
  }

  private sendMediaSignal(peerId: string, msg: RTCSignalingMessage): void {
    this.localSignaling.sendSignaling(peerId, msg);
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
      await this.connectToPeer(peerId);
      // Wait for connection
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (peer.connection?.connected) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 10000);
      });
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
