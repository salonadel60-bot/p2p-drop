/**
 * Core protocol types for P2P Drop cross-platform file transfer.
 * All platforms must implement these types for interoperability.
 */

/** Supported platform types */
export type PlatformType = 'android' | 'desktop-windows' | 'desktop-macos' | 'desktop-linux' | 'web';

/** Network transport capabilities */
export type TransportCapability = 'webrtc' | 'lan-http' | 'direct-socket' | 'wifi-direct';

/** Transfer state machine */
export type TransferState =
  | 'pending'
  | 'negotiating'
  | 'transferring'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Direction of transfer */
export type TransferDirection = 'send' | 'receive';

/** Discovery method used to find the peer */
export type DiscoveryMethod = 'mdns' | 'wifi-direct' | 'nsd' | 'qr-code' | 'manual-link' | 'signaling';

/** Unique device identifier */
export interface DeviceIdentity {
  /** Unique device ID (UUID v4) */
  deviceId: string;
  /** Human-readable device name */
  deviceName: string;
  /** Platform type */
  platform: PlatformType;
  /** Transport capabilities this device supports */
  capabilities: TransportCapability[];
  /** Public key fingerprint for verification */
  publicKeyFingerprint: string;
}

/** File metadata sent during handshake */
export interface FileMetadata {
  /** Unique file transfer ID */
  fileId: string;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** Total file size in bytes */
  fileSize: number;
  /** SHA-256 hash of the complete file */
  sha256: string;
  /** Chunk size in bytes */
  chunkSize: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Last modified timestamp (ISO 8601) */
  lastModified: string;
}

/** Handshake request from sender to receiver */
export interface HandshakeRequest {
  type: 'handshake-request';
  /** Protocol version */
  version: string;
  /** Sender device identity */
  sender: DeviceIdentity;
  /** Files to be transferred */
  files: FileMetadata[];
  /** Session encryption public key (base64) */
  sessionPublicKey: string;
  /** Timestamp */
  timestamp: string;
}

/** Handshake response from receiver to sender */
export interface HandshakeResponse {
  type: 'handshake-response';
  /** Whether the transfer is accepted */
  accepted: boolean;
  /** Receiver device identity */
  receiver: DeviceIdentity;
  /** Accepted file IDs (subset of requested) */
  acceptedFileIds: string[];
  /** Best transport to use */
  selectedTransport: TransportCapability;
  /** Session encryption public key (base64) */
  sessionPublicKey: string;
  /** Reason for rejection (if not accepted) */
  rejectionReason?: string;
  /** Timestamp */
  timestamp: string;
}

/** A single chunk of file data */
export interface ChunkMessage {
  type: 'chunk';
  /** File transfer ID */
  fileId: string;
  /** Chunk index (0-based) */
  chunkIndex: number;
  /** Chunk data (binary) - not serialized in JSON, sent separately */
  data?: ArrayBuffer;
  /** SHA-256 of this chunk for integrity */
  chunkHash: string;
  /** Whether this is the last chunk */
  isLast: boolean;
}

/** Acknowledgement for received chunks */
export interface ChunkAck {
  type: 'chunk-ack';
  /** File transfer ID */
  fileId: string;
  /** Acknowledged chunk indices */
  chunkIndices: number[];
  /** Transfer speed in bytes/sec */
  currentSpeed: number;
}

/** Request to resume a transfer */
export interface ResumeRequest {
  type: 'resume-request';
  /** File transfer ID */
  fileId: string;
  /** Already received chunk indices */
  receivedChunks: number[];
}

/** Transfer progress update */
export interface ProgressUpdate {
  type: 'progress';
  /** File transfer ID */
  fileId: string;
  /** Bytes transferred so far */
  bytesTransferred: number;
  /** Total bytes */
  totalBytes: number;
  /** Current speed in bytes/sec */
  speed: number;
  /** Estimated time remaining in seconds */
  eta: number;
}

/** Transfer completion notification */
export interface TransferComplete {
  type: 'transfer-complete';
  /** File transfer ID */
  fileId: string;
  /** Whether the hash was verified */
  verified: boolean;
  /** Total time in milliseconds */
  totalTimeMs: number;
  /** Average speed in bytes/sec */
  averageSpeed: number;
}

/** Error message */
export interface TransferError {
  type: 'transfer-error';
  /** File transfer ID (if applicable) */
  fileId?: string;
  /** Error code */
  code: TransferErrorCode;
  /** Human-readable message */
  message: string;
}

/** Error codes */
export type TransferErrorCode =
  | 'CONNECTION_LOST'
  | 'HASH_MISMATCH'
  | 'STORAGE_FULL'
  | 'FILE_TOO_LARGE'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'ENCRYPTION_ERROR'
  | 'CANCELLED';

/** Union of all protocol messages */
export type ProtocolMessage =
  | HandshakeRequest
  | HandshakeResponse
  | ChunkMessage
  | ChunkAck
  | ResumeRequest
  | ProgressUpdate
  | TransferComplete
  | TransferError;

/** Discovery announcement broadcast on the network */
export interface DiscoveryAnnouncement {
  type: 'discovery-announcement';
  device: DeviceIdentity;
  /** Port for LAN HTTP server */
  httpPort?: number;
  /** Port for direct socket */
  socketPort?: number;
  /** Whether device is ready to receive */
  readyToReceive: boolean;
}

/** Pairing information encoded in QR code or link */
export interface PairingInfo {
  /** Device identity */
  device: DeviceIdentity;
  /** Connection endpoint */
  endpoint: string;
  /** Pairing code for verification */
  pairingCode: string;
  /** Expiration timestamp */
  expiresAt: string;
}

/** Protocol constants */
export const PROTOCOL_VERSION = '1.0.0';
export const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256KB
export const MAX_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
export const MIN_CHUNK_SIZE = 16 * 1024; // 16KB
export const MAX_PARALLEL_CHUNKS = 8;
export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const CHUNK_TIMEOUT_MS = 60_000;
export const DISCOVERY_INTERVAL_MS = 3_000;
export const DEFAULT_HTTP_PORT = 53317;
export const DEFAULT_SOCKET_PORT = 53318;
