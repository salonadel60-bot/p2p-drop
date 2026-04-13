/**
 * Protocol message serialization/deserialization.
 * Handles JSON encoding with binary chunk data separation.
 */

import type { ProtocolMessage, ChunkMessage } from './types.js';

/** Header for binary framing: 4 bytes length + JSON + optional binary */
const HEADER_SIZE = 4;
const MAGIC_BYTE = 0x50; // 'P' for P2P-Drop

/**
 * Serialize a protocol message to a buffer for transmission.
 * For chunk messages, binary data is appended after the JSON header.
 */
export function serializeMessage(message: ProtocolMessage): ArrayBuffer {
  const jsonPart = { ...message } as Record<string, unknown>;

  // Extract binary data from chunk messages
  let binaryData: ArrayBuffer | undefined;
  if (message.type === 'chunk' && message.data) {
    binaryData = message.data;
    delete jsonPart.data;
  }

  const jsonString = JSON.stringify(jsonPart);
  const jsonBytes = new TextEncoder().encode(jsonString);
  const jsonLength = jsonBytes.byteLength;

  const totalLength = 1 + HEADER_SIZE + jsonLength + (binaryData?.byteLength ?? 0);
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Write magic byte
  view.setUint8(0, MAGIC_BYTE);

  // Write JSON length (4 bytes, big-endian)
  view.setUint32(1, jsonLength, false);

  // Write JSON data
  uint8.set(jsonBytes, 1 + HEADER_SIZE);

  // Write binary data if present
  if (binaryData) {
    uint8.set(new Uint8Array(binaryData), 1 + HEADER_SIZE + jsonLength);
  }

  return buffer;
}

/**
 * Deserialize a buffer into a protocol message.
 */
export function deserializeMessage(buffer: ArrayBuffer): ProtocolMessage {
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Verify magic byte
  const magic = view.getUint8(0);
  if (magic !== MAGIC_BYTE) {
    throw new Error(`Invalid magic byte: expected 0x${MAGIC_BYTE.toString(16)}, got 0x${magic.toString(16)}`);
  }

  // Read JSON length
  const jsonLength = view.getUint32(1, false);

  // Read JSON data
  const jsonBytes = uint8.slice(1 + HEADER_SIZE, 1 + HEADER_SIZE + jsonLength);
  const jsonString = new TextDecoder().decode(jsonBytes);
  const message = JSON.parse(jsonString) as ProtocolMessage;

  // Read binary data if this is a chunk message
  if (message.type === 'chunk') {
    const binaryStart = 1 + HEADER_SIZE + jsonLength;
    if (binaryStart < buffer.byteLength) {
      (message as ChunkMessage).data = buffer.slice(binaryStart);
    }
  }

  return message;
}

/**
 * Serialize a message to JSON string (for WebRTC text channels or signaling).
 * Does NOT include binary data — use serializeMessage for chunks with data.
 */
export function serializeToJSON(message: ProtocolMessage): string {
  const jsonPart = { ...message } as Record<string, unknown>;
  if (message.type === 'chunk') {
    delete jsonPart.data;
  }
  return JSON.stringify(jsonPart);
}

/**
 * Deserialize a JSON string into a protocol message.
 */
export function deserializeFromJSON(json: string): ProtocolMessage {
  return JSON.parse(json) as ProtocolMessage;
}
