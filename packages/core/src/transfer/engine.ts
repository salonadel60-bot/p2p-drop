/**
 * Transfer Engine - handles chunked file transfers with resume,
 * parallel chunks, integrity validation, and adaptive chunk sizing.
 */

import type {
  FileMetadata,
  ChunkMessage,
  ChunkAck,
  ProgressUpdate,
  TransferComplete,
  TransferError,
  TransferState,
} from '../protocol/types.js';
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_PARALLEL_CHUNKS,
} from '../protocol/types.js';
import { sha256 } from '../crypto/encryption.js';

/** Transport interface — implemented by each platform/transport */
export interface TransferTransport {
  /** Send a chunk message with binary data */
  sendChunk(chunk: ChunkMessage, data: ArrayBuffer): Promise<void>;
  /** Send a control message (ack, progress, etc.) */
  sendControl(message: ChunkAck | ProgressUpdate | TransferComplete | TransferError): Promise<void>;
  /** Register handler for incoming chunks */
  onChunk(handler: (chunk: ChunkMessage, data: ArrayBuffer) => void): void;
  /** Register handler for incoming control messages */
  onControl(handler: (message: ChunkAck | ProgressUpdate | TransferComplete | TransferError) => void): void;
}

/** File data source interface */
export interface FileSource {
  /** Read a chunk of data from the file */
  readChunk(offset: number, length: number): Promise<ArrayBuffer>;
  /** Get total file size */
  size: number;
}

/** File data sink interface */
export interface FileSink {
  /** Write a chunk of data at offset */
  writeChunk(offset: number, data: ArrayBuffer): Promise<void>;
  /** Finalize the file (flush, rename, etc.) */
  finalize(): Promise<void>;
  /** Get bytes written so far */
  bytesWritten: number;
}

/** Events emitted by the transfer engine */
export interface TransferEvents {
  onProgress?: (update: ProgressUpdate) => void;
  onComplete?: (result: TransferComplete) => void;
  onError?: (error: TransferError) => void;
  onStateChange?: (fileId: string, state: TransferState) => void;
}

/** Adaptive engine configuration */
interface AdaptiveConfig {
  chunkSize: number;
  parallelChunks: number;
  lastSpeed: number;
  speedSamples: number[];
}

/**
 * Sender-side transfer engine.
 * Reads file data and sends chunks to the receiver.
 */
export class FileSender {
  private state: TransferState = 'pending';
  private adaptive: AdaptiveConfig;
  private sentChunks = new Set<number>();
  private ackedChunks = new Set<number>();
  private inFlightChunks = new Set<number>();
  private startTime = 0;
  private totalBytesSent = 0;
  private _cancelled = false;

  constructor(
    private readonly metadata: FileMetadata,
    private readonly source: FileSource,
    private readonly transport: TransferTransport,
    private readonly events: TransferEvents = {}
  ) {
    this.adaptive = {
      chunkSize: metadata.chunkSize || DEFAULT_CHUNK_SIZE,
      parallelChunks: 4,
      lastSpeed: 0,
      speedSamples: [],
    };

    this.transport.onControl((msg) => {
      if (msg.type === 'chunk-ack' && msg.fileId === this.metadata.fileId) {
        this.handleAck(msg);
      }
    });
  }

  get currentState(): TransferState { return this.state; }

  /** Start sending the file */
  async send(resumeFrom?: number[]): Promise<void> {
    this.state = 'transferring';
    this.events.onStateChange?.(this.metadata.fileId, this.state);
    this.startTime = Date.now();

    // Mark already-received chunks if resuming
    if (resumeFrom) {
      for (const idx of resumeFrom) {
        this.ackedChunks.add(idx);
        this.sentChunks.add(idx);
      }
    }

    try {
      await this.sendLoop();
    } catch (err) {
      if (this._cancelled) return;
      this.state = 'failed';
      this.events.onStateChange?.(this.metadata.fileId, this.state);
      const error: TransferError = {
        type: 'transfer-error',
        fileId: this.metadata.fileId,
        code: 'CONNECTION_LOST',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      this.events.onError?.(error);
      this.transport.sendControl(error);
    }
  }

  /** Cancel the transfer */
  cancel(): void {
    this._cancelled = true;
    this.state = 'cancelled';
    this.events.onStateChange?.(this.metadata.fileId, this.state);
  }

  /** Pause the transfer */
  pause(): void {
    if (this.state === 'transferring') {
      this.state = 'paused';
      this.events.onStateChange?.(this.metadata.fileId, this.state);
    }
  }

  /** Resume the transfer */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'transferring';
      this.events.onStateChange?.(this.metadata.fileId, this.state);
    }
  }

  private async sendLoop(): Promise<void> {
    const totalChunks = this.metadata.totalChunks;

    while (this.ackedChunks.size < totalChunks && !this._cancelled) {
      if (this.state === 'paused') {
        await sleep(100);
        continue;
      }

      // Fill the pipeline with parallel chunks
      while (
        this.inFlightChunks.size < this.adaptive.parallelChunks &&
        this.sentChunks.size < totalChunks
      ) {
        const nextChunk = this.findNextChunk(totalChunks);
        if (nextChunk === -1) break;

        this.inFlightChunks.add(nextChunk);
        this.sentChunks.add(nextChunk);
        this.sendSingleChunk(nextChunk).catch(() => {
          this.inFlightChunks.delete(nextChunk);
          this.sentChunks.delete(nextChunk);
        });
      }

      // Wait a bit before checking again
      await sleep(10);
    }

    if (!this._cancelled) {
      this.state = 'completed';
      this.events.onStateChange?.(this.metadata.fileId, this.state);
      const elapsed = Date.now() - this.startTime;
      const complete: TransferComplete = {
        type: 'transfer-complete',
        fileId: this.metadata.fileId,
        verified: true,
        totalTimeMs: elapsed,
        averageSpeed: this.totalBytesSent / (elapsed / 1000),
      };
      this.events.onComplete?.(complete);
      await this.transport.sendControl(complete);
    }
  }

  private findNextChunk(total: number): number {
    for (let i = 0; i < total; i++) {
      if (!this.sentChunks.has(i)) return i;
    }
    return -1;
  }

  private async sendSingleChunk(index: number): Promise<void> {
    const offset = index * this.adaptive.chunkSize;
    const length = Math.min(this.adaptive.chunkSize, this.source.size - offset);
    const data = await this.source.readChunk(offset, length);
    const chunkHash = await sha256(data);

    const chunk: ChunkMessage = {
      type: 'chunk',
      fileId: this.metadata.fileId,
      chunkIndex: index,
      chunkHash,
      isLast: index === this.metadata.totalChunks - 1,
    };

    await this.transport.sendChunk(chunk, data);
    this.totalBytesSent += data.byteLength;
    this.emitProgress();
  }

  private handleAck(ack: ChunkAck): void {
    for (const idx of ack.chunkIndices) {
      this.ackedChunks.add(idx);
      this.inFlightChunks.delete(idx);
    }

    // Adaptive: adjust parallelism based on speed
    if (ack.currentSpeed > 0) {
      this.adaptive.speedSamples.push(ack.currentSpeed);
      if (this.adaptive.speedSamples.length > 10) {
        this.adaptive.speedSamples.shift();
      }
      this.adaptiveAdjust();
    }
  }

  private adaptiveAdjust(): void {
    const samples = this.adaptive.speedSamples;
    if (samples.length < 3) return;

    const avgSpeed = samples.reduce((a, b) => a + b, 0) / samples.length;
    const lastSpeed = samples[samples.length - 1];

    // If speed is increasing, increase parallelism and chunk size
    if (lastSpeed > avgSpeed * 1.1) {
      this.adaptive.parallelChunks = Math.min(
        this.adaptive.parallelChunks + 1,
        MAX_PARALLEL_CHUNKS
      );
      this.adaptive.chunkSize = Math.min(
        this.adaptive.chunkSize * 2,
        MAX_CHUNK_SIZE
      );
    }
    // If speed is decreasing, reduce parallelism
    else if (lastSpeed < avgSpeed * 0.7) {
      this.adaptive.parallelChunks = Math.max(this.adaptive.parallelChunks - 1, 1);
      this.adaptive.chunkSize = Math.max(
        Math.floor(this.adaptive.chunkSize / 2),
        MIN_CHUNK_SIZE
      );
    }
  }

  private emitProgress(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = this.totalBytesSent / elapsed;
    const remaining = this.metadata.fileSize - this.totalBytesSent;
    const eta = speed > 0 ? remaining / speed : 0;

    const progress: ProgressUpdate = {
      type: 'progress',
      fileId: this.metadata.fileId,
      bytesTransferred: this.totalBytesSent,
      totalBytes: this.metadata.fileSize,
      speed,
      eta,
    };
    this.events.onProgress?.(progress);
  }
}

/**
 * Receiver-side transfer engine.
 * Receives chunks and writes them to storage.
 */
export class FileReceiver {
  private state: TransferState = 'pending';
  private receivedChunks = new Set<number>();
  private startTime = 0;
  private totalBytesReceived = 0;
  private _cancelled = false;
  private ackBuffer: number[] = [];
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly metadata: FileMetadata,
    private readonly sink: FileSink,
    private readonly transport: TransferTransport,
    private readonly events: TransferEvents = {}
  ) {
    this.transport.onChunk((chunk, data) => {
      if (chunk.fileId === this.metadata.fileId) {
        this.handleChunk(chunk, data);
      }
    });

    this.transport.onControl((msg) => {
      if (msg.type === 'transfer-complete' && msg.fileId === this.metadata.fileId) {
        this.handleComplete();
      }
    });
  }

  get currentState(): TransferState { return this.state; }

  /** Get list of already received chunk indices (for resume) */
  getReceivedChunks(): number[] {
    return Array.from(this.receivedChunks);
  }

  /** Start receiving */
  startReceiving(): void {
    this.state = 'transferring';
    this.startTime = Date.now();
    this.events.onStateChange?.(this.metadata.fileId, this.state);
  }

  /** Cancel receiving */
  cancel(): void {
    this._cancelled = true;
    this.state = 'cancelled';
    this.events.onStateChange?.(this.metadata.fileId, this.state);
    if (this.ackTimer) clearTimeout(this.ackTimer);
  }

  private async handleChunk(chunk: ChunkMessage, data: ArrayBuffer): Promise<void> {
    if (this._cancelled) return;
    if (this.receivedChunks.has(chunk.chunkIndex)) {
      // Duplicate chunk — ack but don't write
      this.bufferAck(chunk.chunkIndex);
      return;
    }

    // Verify chunk integrity
    const computedHash = await sha256(data);
    if (computedHash !== chunk.chunkHash) {
      const error: TransferError = {
        type: 'transfer-error',
        fileId: this.metadata.fileId,
        code: 'HASH_MISMATCH',
        message: `Chunk ${chunk.chunkIndex} hash mismatch`,
      };
      this.events.onError?.(error);
      await this.transport.sendControl(error);
      return;
    }

    // Write chunk to storage
    const offset = chunk.chunkIndex * this.metadata.chunkSize;
    await this.sink.writeChunk(offset, data);
    this.receivedChunks.add(chunk.chunkIndex);
    this.totalBytesReceived += data.byteLength;

    // Buffer ack for batch sending
    this.bufferAck(chunk.chunkIndex);
    this.emitProgress();
  }

  private bufferAck(chunkIndex: number): void {
    this.ackBuffer.push(chunkIndex);

    // Send ack every 50ms or every 16 chunks
    if (this.ackBuffer.length >= 16) {
      this.flushAcks();
    } else if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => this.flushAcks(), 50);
    }
  }

  private flushAcks(): void {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    if (this.ackBuffer.length === 0) return;

    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = this.totalBytesReceived / elapsed;

    const ack: ChunkAck = {
      type: 'chunk-ack',
      fileId: this.metadata.fileId,
      chunkIndices: [...this.ackBuffer],
      currentSpeed: speed,
    };

    this.ackBuffer = [];
    this.transport.sendControl(ack);
  }

  private async handleComplete(): Promise<void> {
    this.state = 'verifying';
    this.events.onStateChange?.(this.metadata.fileId, this.state);
    this.flushAcks();

    await this.sink.finalize();

    this.state = 'completed';
    this.events.onStateChange?.(this.metadata.fileId, this.state);

    const elapsed = Date.now() - this.startTime;
    const complete: TransferComplete = {
      type: 'transfer-complete',
      fileId: this.metadata.fileId,
      verified: true,
      totalTimeMs: elapsed,
      averageSpeed: this.totalBytesReceived / (elapsed / 1000),
    };
    this.events.onComplete?.(complete);
  }

  private emitProgress(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = this.totalBytesReceived / elapsed;
    const remaining = this.metadata.fileSize - this.totalBytesReceived;
    const eta = speed > 0 ? remaining / speed : 0;

    const progress: ProgressUpdate = {
      type: 'progress',
      fileId: this.metadata.fileId,
      bytesTransferred: this.totalBytesReceived,
      totalBytes: this.metadata.fileSize,
      speed,
      eta,
    };
    this.events.onProgress?.(progress);
  }
}

/**
 * Create FileMetadata from file info.
 */
export function createFileMetadata(
  fileName: string,
  fileSize: number,
  mimeType: string,
  sha256Hash: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): FileMetadata {
  const totalChunks = Math.ceil(fileSize / chunkSize);
  return {
    fileId: generateTransferId(),
    fileName,
    mimeType,
    fileSize,
    sha256: sha256Hash,
    chunkSize,
    totalChunks,
    lastModified: new Date().toISOString(),
  };
}

/**
 * Compute optimal chunk size based on file size.
 */
export function computeOptimalChunkSize(fileSize: number): number {
  if (fileSize < 1024 * 1024) return MIN_CHUNK_SIZE; // < 1MB: 16KB chunks
  if (fileSize < 100 * 1024 * 1024) return DEFAULT_CHUNK_SIZE; // < 100MB: 256KB chunks
  if (fileSize < 1024 * 1024 * 1024) return 1024 * 1024; // < 1GB: 1MB chunks
  return MAX_CHUNK_SIZE; // >= 1GB: 4MB chunks
}

function generateTransferId(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
