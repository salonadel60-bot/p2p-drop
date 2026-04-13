/**
 * P2P Drop Web Application - Main entry point.
 * Coordinates WebRTC connections, file transfer, and UI.
 */

import {
  type DeviceIdentity,
  type FileMetadata,
  type HandshakeRequest,
  type HandshakeResponse,
  PROTOCOL_VERSION,
  getOrCreateIdentity,
  SessionStorageAdapter,
  generateSessionKeyPair,
  computeOptimalChunkSize,
  createFileMetadata,
  FileSender,
  FileReceiver,
  generatePairingInfo,
  generatePairingURL,
} from '@p2p-drop/core';

import {
  LocalSignaling,
  WebSocketSignaling,
  WebRTCPeerConnection,
  WebRTCTransport,
} from './webrtc/index.js';
import type { RTCSignalingMessage } from './webrtc/index.js';
import { BrowserFileSource, BrowserFileSink, computeFileSHA256 } from './ui/file-handler.js';
import { renderUI, updatePeerList, updateTransferProgress, showNotification, addTransferEntry, updateTransferState } from './ui/renderer.js';

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

  async init(): Promise<void> {
    // Get or create device identity
    this.identity = await getOrCreateIdentity(new SessionStorageAdapter());

    // Render the UI
    renderUI(this.identity, {
      onFilesSelected: (files, peerId) => this.sendFiles(files, peerId),
      onPeerClick: (peerId) => this.connectToPeer(peerId),
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

  private setupPairing(): void {
    const pairingInfo = generatePairingInfo(
      this.identity,
      window.location.href,
      30
    );
    const pairingURL = generatePairingURL(window.location.origin, pairingInfo);

    // Display pairing URL in the UI
    const pairingElement = document.getElementById('pairing-url');
    if (pairingElement) {
      pairingElement.textContent = pairingURL;
    }

    // Generate QR code
    this.generateQRCode(pairingURL);
  }

  private async generateQRCode(data: string): Promise<void> {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    try {
      const QRCode = await import('qrcode');
      await QRCode.toCanvas(canvas, data, {
        width: 200,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
    } catch {
      // QR code generation failed, show text fallback
      console.warn('[P2P Drop] QR code generation not available');
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
        onStateChange: (fId, state) => {
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

// Boot the app
const app = new P2PDropApp();
app.init().catch(console.error);

// Export for use in dev console
(window as unknown as Record<string, unknown>).p2pDrop = app;

export { P2PDropApp, formatSize };
