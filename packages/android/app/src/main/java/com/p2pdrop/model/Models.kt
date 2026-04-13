package com.p2pdrop.model

import kotlinx.serialization.Serializable

@Serializable
data class DeviceIdentity(
    val deviceId: String,
    val deviceName: String,
    val platform: String,
    val capabilities: List<String>,
    val publicKeyFingerprint: String
)

@Serializable
data class FileMetadata(
    val fileId: String,
    val fileName: String,
    val mimeType: String,
    val fileSize: Long,
    val sha256: String,
    val chunkSize: Int,
    val totalChunks: Int,
    val lastModified: String
)

@Serializable
data class HandshakeRequest(
    val type: String = "handshake-request",
    val version: String,
    val sender: DeviceIdentity,
    val files: List<FileMetadata>,
    val sessionPublicKey: String,
    val timestamp: String
)

@Serializable
data class HandshakeResponse(
    val type: String = "handshake-response",
    val accepted: Boolean,
    val receiver: DeviceIdentity,
    val acceptedFileIds: List<String>,
    val selectedTransport: String,
    val sessionPublicKey: String,
    val rejectionReason: String? = null,
    val timestamp: String
)

@Serializable
data class DiscoveryInfo(
    val device: DeviceIdentity,
    val version: String,
    val ready: Boolean
)

data class DiscoveredPeer(
    val device: DeviceIdentity,
    val address: String,
    val port: Int,
    val method: String,
    val lastSeen: Long = System.currentTimeMillis(),
    val quality: Int = 100
)

data class TransferProgress(
    val fileId: String,
    val fileName: String,
    val bytesTransferred: Long,
    val totalBytes: Long,
    val speed: Long,
    val state: TransferState,
    val direction: TransferDirection,
    val peerName: String
)

enum class TransferState {
    PENDING, NEGOTIATING, TRANSFERRING, PAUSED, VERIFYING, COMPLETED, FAILED, CANCELLED
}

enum class TransferDirection {
    SEND, RECEIVE
}
