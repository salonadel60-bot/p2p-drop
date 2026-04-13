/**
 * WebRTC transport adapter implementing the core TransferTransport interface.
 */

import type {
  ChunkMessage,
  ChunkAck,
  ProgressUpdate,
  TransferComplete,
  TransferError,
} from '@p2p-drop/core';
import type { TransferTransport } from '@p2p-drop/core';
import type { WebRTCPeerConnection } from './peer-connection.js';

export class WebRTCTransport implements TransferTransport {
  private chunkHandlers: Array<(chunk: ChunkMessage, data: ArrayBuffer) => void> = [];
  private controlHandlers: Array<(msg: ChunkAck | ProgressUpdate | TransferComplete | TransferError) => void> = [];

  constructor(private readonly connection: WebRTCPeerConnection) {}

  async sendChunk(chunk: ChunkMessage, data: ArrayBuffer): Promise<void> {
    this.connection.sendChunk(chunk, data);
  }

  async sendControl(message: ChunkAck | ProgressUpdate | TransferComplete | TransferError): Promise<void> {
    this.connection.sendControlMsg(message);
  }

  onChunk(handler: (chunk: ChunkMessage, data: ArrayBuffer) => void): void {
    this.chunkHandlers.push(handler);
  }

  onControl(handler: (msg: ChunkAck | ProgressUpdate | TransferComplete | TransferError) => void): void {
    this.controlHandlers.push(handler);
  }

  /** Called by the peer connection when a chunk is received */
  handleIncomingChunk(chunk: ChunkMessage, data: ArrayBuffer): void {
    for (const handler of this.chunkHandlers) {
      handler(chunk, data);
    }
  }

  /** Called by the peer connection when a control message is received */
  handleIncomingControl(message: ChunkAck | ProgressUpdate | TransferComplete | TransferError): void {
    for (const handler of this.controlHandlers) {
      handler(message);
    }
  }
}
