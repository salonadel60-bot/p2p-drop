package com.p2pdrop.ui.screens

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.p2pdrop.discovery.NsdDiscoveryService
import com.p2pdrop.model.*
import com.p2pdrop.network.HttpTransferClient
import com.p2pdrop.network.HttpTransferServer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest
import java.util.UUID

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _identity = MutableStateFlow<DeviceIdentity?>(null)
    val identity: StateFlow<DeviceIdentity?> = _identity

    private val _peers = MutableStateFlow<List<DiscoveredPeer>>(emptyList())
    val peers: StateFlow<List<DiscoveredPeer>> = _peers

    private val _transfers = MutableStateFlow<List<TransferProgress>>(emptyList())
    val transfers: StateFlow<List<TransferProgress>> = _transfers

    private val _selectedPeer = MutableStateFlow<DiscoveredPeer?>(null)
    val selectedPeer: StateFlow<DiscoveredPeer?> = _selectedPeer

    private var discoveryService: NsdDiscoveryService? = null
    private var httpServer: HttpTransferServer? = null
    private var serverPort = 0

    init {
        initializeIdentity()
        startServices()
    }

    private fun initializeIdentity() {
        val prefs = getApplication<Application>().getSharedPreferences("p2p_drop", 0)
        val deviceId = prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("device_id", it).apply()
        }
        val deviceName = android.os.Build.MODEL

        _identity.value = DeviceIdentity(
            deviceId = deviceId,
            deviceName = deviceName,
            platform = "android",
            capabilities = listOf("lan-http", "direct-socket", "wifi-direct", "webrtc"),
            publicKeyFingerprint = ""
        )
    }

    private fun startServices() {
        val identity = _identity.value ?: return
        val context = getApplication<Application>()

        // Start HTTP server for receiving
        httpServer = HttpTransferServer(
            identity = identity,
            onTransferRequest = { request ->
                // Auto-accept for now
                HandshakeResponse(
                    accepted = true,
                    receiver = identity,
                    acceptedFileIds = request.files.map { it.fileId },
                    selectedTransport = "lan-http",
                    sessionPublicKey = "",
                    timestamp = java.time.Instant.now().toString()
                )
            },
            onChunkReceived = { fileId, chunkIndex, data ->
                // Write chunk to file
                val downloadsDir = File(context.getExternalFilesDir(null), "P2PDrop")
                downloadsDir.mkdirs()
                // Chunk handling is simplified for now
            },
            onTransferComplete = { fileId, filePath ->
                updateTransferState(fileId, TransferState.COMPLETED)
            }
        )
        serverPort = httpServer?.start() ?: 53317

        // Start NSD discovery
        discoveryService = NsdDiscoveryService(context)
        discoveryService?.registerService(identity, serverPort)
        discoveryService?.startDiscovery()
        discoveryService?.startHttpProbing()

        // Collect discovered peers
        viewModelScope.launch {
            discoveryService?.peers?.collect { peers ->
                _peers.value = peers
            }
        }
    }

    fun selectPeer(peer: DiscoveredPeer) {
        _selectedPeer.value = peer
    }

    fun sendFiles(files: List<File>) {
        val peer = _selectedPeer.value ?: return
        val identity = _identity.value ?: return

        viewModelScope.launch {
            try {
                val client = HttpTransferClient("http://${peer.address}:${peer.port}")

                val fileMetadataList = files.map { file ->
                    val chunkSize = when {
                        file.length() < 1024 * 1024 -> 16 * 1024
                        file.length() < 100 * 1024 * 1024 -> 256 * 1024
                        file.length() < 1024 * 1024 * 1024 -> 1024 * 1024
                        else -> 4 * 1024 * 1024
                    }

                    val hash = MessageDigest.getInstance("SHA-256")
                        .digest(file.readBytes())
                        .joinToString("") { "%02x".format(it) }

                    FileMetadata(
                        fileId = UUID.randomUUID().toString(),
                        fileName = file.name,
                        mimeType = "application/octet-stream",
                        fileSize = file.length(),
                        sha256 = hash,
                        chunkSize = chunkSize,
                        totalChunks = ((file.length() + chunkSize - 1) / chunkSize).toInt(),
                        lastModified = java.time.Instant.ofEpochMilli(file.lastModified()).toString()
                    )
                }

                val request = HandshakeRequest(
                    version = "1.0.0",
                    sender = identity,
                    files = fileMetadataList,
                    sessionPublicKey = "",
                    timestamp = java.time.Instant.now().toString()
                )

                val response = client.sendHandshake(request)
                if (!response.accepted) {
                    return@launch
                }

                // Send each file
                for (i in files.indices) {
                    val file = files[i]
                    val metadata = fileMetadataList[i]

                    val transfer = TransferProgress(
                        fileId = metadata.fileId,
                        fileName = metadata.fileName,
                        bytesTransferred = 0,
                        totalBytes = metadata.fileSize,
                        speed = 0,
                        state = TransferState.TRANSFERRING,
                        direction = TransferDirection.SEND,
                        peerName = peer.device.deviceName
                    )
                    addTransfer(transfer)

                    client.sendFile(file, metadata) { sent, total ->
                        updateTransferProgress(metadata.fileId, sent, total)
                    }

                    updateTransferState(metadata.fileId, TransferState.COMPLETED)
                }
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    private fun addTransfer(transfer: TransferProgress) {
        _transfers.value = _transfers.value + transfer
    }

    private fun updateTransferProgress(fileId: String, bytes: Long, total: Long) {
        _transfers.value = _transfers.value.map {
            if (it.fileId == fileId) it.copy(bytesTransferred = bytes, totalBytes = total)
            else it
        }
    }

    private fun updateTransferState(fileId: String, state: TransferState) {
        _transfers.value = _transfers.value.map {
            if (it.fileId == fileId) it.copy(state = state)
            else it
        }
    }

    override fun onCleared() {
        super.onCleared()
        discoveryService?.destroy()
        httpServer?.stop()
    }
}
