/**
 * LAN HTTP Transfer Server for desktop-to-desktop and desktop-to-mobile transfers.
 * Runs a local HTTP server that peers can connect to for file transfer.
 */

import express from 'express';
import multer from 'multer';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DeviceIdentity, FileMetadata, HandshakeRequest, HandshakeResponse } from '@p2p-drop/core';
import { PROTOCOL_VERSION, DEFAULT_HTTP_PORT } from '@p2p-drop/core';

export interface LANServerEvents {
  onPeerConnected: (peerDevice: DeviceIdentity) => void;
  onTransferRequest: (request: HandshakeRequest, respond: (accepted: boolean, savePath?: string) => void) => void;
  onTransferProgress: (fileId: string, bytesReceived: number, totalBytes: number) => void;
  onTransferComplete: (fileId: string, filePath: string) => void;
  onTransferError: (fileId: string, error: string) => void;
}

export class LANTransferServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private _port: number;
  private activeTransfers = new Map<string, { metadata: FileMetadata; savePath: string; bytesReceived: number }>();

  constructor(
    private readonly identity: DeviceIdentity,
    private readonly events: LANServerEvents,
    port: number = DEFAULT_HTTP_PORT
  ) {
    this._port = port;
    this.app = express();
    this.setupRoutes();
  }

  get port(): number { return this._port; }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this._port, '0.0.0.0', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
        }
        console.log(`[LAN Server] Listening on port ${this._port}`);
        resolve(this._port);
      });
      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          this._port++;
          this.server = this.app.listen(this._port, '0.0.0.0', () => {
            resolve(this._port);
          });
        } else {
          reject(err);
        }
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private setupRoutes(): void {
    this.app.use(express.json({ limit: '1mb' }));

    // Device discovery endpoint
    this.app.get('/api/info', (_req, res) => {
      res.json({
        device: this.identity,
        version: PROTOCOL_VERSION,
        ready: true,
      });
    });

    // Handshake endpoint - sender requests to send files
    this.app.post('/api/handshake', (req, res) => {
      const request = req.body as HandshakeRequest;
      this.events.onPeerConnected(request.sender);

      this.events.onTransferRequest(request, (accepted, savePath) => {
        const response: HandshakeResponse = {
          type: 'handshake-response',
          accepted,
          receiver: this.identity,
          acceptedFileIds: accepted ? request.files.map(f => f.fileId) : [],
          selectedTransport: 'lan-http',
          sessionPublicKey: '',
          timestamp: new Date().toISOString(),
        };

        if (accepted && savePath) {
          // Set up receiving for each file
          for (const file of request.files) {
            this.activeTransfers.set(file.fileId, {
              metadata: file,
              savePath: path.join(savePath, file.fileName),
              bytesReceived: 0,
            });
          }
        }

        res.json(response);
      });
    });

    // Chunked file upload endpoint
    const upload = multer({ storage: multer.memoryStorage() });
    this.app.post('/api/upload/:fileId', upload.single('chunk'), (req, res) => {
      const { fileId } = req.params;
      const chunkIndex = parseInt(req.headers['x-chunk-index'] as string, 10);
      const chunkHash = req.headers['x-chunk-hash'] as string;
      const transfer = this.activeTransfers.get(fileId);

      if (!transfer) {
        res.status(404).json({ error: 'Transfer not found' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No chunk data' });
        return;
      }

      const data = req.file.buffer;

      // Verify chunk hash
      const computedHash = crypto.createHash('sha256').update(data).digest('hex');
      if (chunkHash && computedHash !== chunkHash) {
        res.status(400).json({ error: 'Hash mismatch' });
        return;
      }

      // Write chunk to file
      const offset = chunkIndex * transfer.metadata.chunkSize;
      try {
        const fd = fs.openSync(transfer.savePath, offset === 0 ? 'w' : 'r+');
        fs.writeSync(fd, data, 0, data.length, offset);
        fs.closeSync(fd);

        transfer.bytesReceived += data.length;
        this.events.onTransferProgress(fileId, transfer.bytesReceived, transfer.metadata.fileSize);

        // Check if transfer is complete
        if (transfer.bytesReceived >= transfer.metadata.fileSize) {
          this.events.onTransferComplete(fileId, transfer.savePath);
          this.activeTransfers.delete(fileId);
        }

        res.json({ received: chunkIndex, bytesReceived: transfer.bytesReceived });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Write failed';
        this.events.onTransferError(fileId, message);
        res.status(500).json({ error: message });
      }
    });

    // Download endpoint - for receiver pulling files
    this.app.get('/api/download/:fileId', (req, res) => {
      const { fileId } = req.params;
      const transfer = this.activeTransfers.get(fileId);
      if (!transfer) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const filePath = transfer.savePath;
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'File not available' });
        return;
      }

      res.setHeader('Content-Type', transfer.metadata.mimeType);
      res.setHeader('Content-Length', transfer.metadata.fileSize.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${transfer.metadata.fileName}"`);

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    });

    // File listing for sender to offer files
    this.app.get('/api/files', (_req, res) => {
      const transfers = Array.from(this.activeTransfers.entries()).map(([id, t]) => ({
        fileId: id,
        fileName: t.metadata.fileName,
        fileSize: t.metadata.fileSize,
        mimeType: t.metadata.mimeType,
        progress: t.bytesReceived / t.metadata.fileSize,
      }));
      res.json({ files: transfers });
    });
  }
}

/**
 * LAN HTTP client for sending files to a LAN server.
 */
export class LANTransferClient {
  constructor(private readonly baseUrl: string) {}

  /** Get device info from the server */
  async getDeviceInfo(): Promise<{ device: DeviceIdentity; version: string }> {
    const res = await fetch(`${this.baseUrl}/api/info`);
    return res.json() as Promise<{ device: DeviceIdentity; version: string }>;
  }

  /** Send handshake request */
  async sendHandshake(request: HandshakeRequest): Promise<HandshakeResponse> {
    const res = await fetch(`${this.baseUrl}/api/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return res.json() as Promise<HandshakeResponse>;
  }

  /** Send a file chunk */
  async sendChunk(
    fileId: string,
    chunkIndex: number,
    data: Buffer,
    chunkHash: string,
    onProgress?: (sent: number) => void
  ): Promise<void> {
    const formData = new FormData();
    formData.append('chunk', new Blob([new Uint8Array(data)]));

    const res = await fetch(`${this.baseUrl}/api/upload/${fileId}`, {
      method: 'POST',
      headers: {
        'x-chunk-index': chunkIndex.toString(),
        'x-chunk-hash': chunkHash,
      },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json() as { error: string };
      throw new Error(error.error || 'Upload failed');
    }

    if (onProgress) {
      onProgress(data.length);
    }
  }

  /** Send a complete file using chunked upload */
  async sendFile(
    filePath: string,
    metadata: FileMetadata,
    onProgress?: (bytesSent: number, totalBytes: number) => void
  ): Promise<void> {
    const fd = fs.openSync(filePath, 'r');
    let bytesSent = 0;

    try {
      for (let i = 0; i < metadata.totalChunks; i++) {
        const offset = i * metadata.chunkSize;
        const length = Math.min(metadata.chunkSize, metadata.fileSize - offset);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);

        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        await this.sendChunk(metadata.fileId, i, buffer, hash);

        bytesSent += length;
        if (onProgress) {
          onProgress(bytesSent, metadata.fileSize);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}
