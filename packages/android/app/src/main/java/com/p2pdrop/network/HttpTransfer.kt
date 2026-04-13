package com.p2pdrop.network

import android.util.Log
import com.p2pdrop.model.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import java.io.*
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.security.MessageDigest

/**
 * LAN HTTP Server for receiving file transfers.
 * Runs a lightweight HTTP server that peers can connect to.
 */
class HttpTransferServer(
    private val identity: DeviceIdentity,
    private val onTransferRequest: (HandshakeRequest) -> HandshakeResponse,
    private val onChunkReceived: (String, Int, ByteArray) -> Unit,
    private val onTransferComplete: (String, String) -> Unit
) {
    companion object {
        private const val TAG = "HttpTransferServer"
    }

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var serverSocket: ServerSocket? = null
    private var serverJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    var port: Int = 0
        private set

    fun start(preferredPort: Int = 53317): Int {
        serverSocket = try {
            ServerSocket(preferredPort)
        } catch (_: Exception) {
            ServerSocket(0) // Use any available port
        }
        port = serverSocket!!.localPort

        serverJob = scope.launch {
            Log.i(TAG, "Server started on port $port")
            while (isActive) {
                try {
                    val socket = serverSocket?.accept() ?: break
                    launch { handleConnection(socket) }
                } catch (_: Exception) {
                    break
                }
            }
        }

        return port
    }

    fun stop() {
        serverJob?.cancel()
        serverSocket?.close()
        serverSocket = null
    }

    private suspend fun handleConnection(socket: java.net.Socket) {
        withContext(Dispatchers.IO) {
            try {
                val input = BufferedReader(InputStreamReader(socket.getInputStream()))
                val output = BufferedOutputStream(socket.getOutputStream())

                val requestLine = input.readLine() ?: return@withContext
                val parts = requestLine.split(" ")
                if (parts.size < 2) return@withContext

                val method = parts[0]
                val path = parts[1]

                // Read headers
                val headers = mutableMapOf<String, String>()
                var line = input.readLine()
                var contentLength = 0
                while (line != null && line.isNotEmpty()) {
                    val colonIdx = line.indexOf(':')
                    if (colonIdx > 0) {
                        val key = line.substring(0, colonIdx).trim().lowercase()
                        val value = line.substring(colonIdx + 1).trim()
                        headers[key] = value
                        if (key == "content-length") {
                            contentLength = value.toIntOrNull() ?: 0
                        }
                    }
                    line = input.readLine()
                }

                when {
                    method == "GET" && path == "/api/info" -> {
                        val info = DiscoveryInfo(
                            device = identity,
                            version = "1.0.0",
                            ready = true
                        )
                        sendJsonResponse(output, 200, json.encodeToString(info))
                    }

                    method == "POST" && path == "/api/handshake" -> {
                        val body = readBody(socket.getInputStream(), contentLength)
                        val request = json.decodeFromString<HandshakeRequest>(body)
                        val response = onTransferRequest(request)
                        sendJsonResponse(output, 200, json.encodeToString(response))
                    }

                    method == "POST" && path.startsWith("/api/upload/") -> {
                        val fileId = path.removePrefix("/api/upload/")
                        val chunkIndex = headers["x-chunk-index"]?.toIntOrNull() ?: 0
                        val chunkData = readBinaryBody(socket.getInputStream(), contentLength)

                        onChunkReceived(fileId, chunkIndex, chunkData)
                        sendJsonResponse(output, 200, """{"received": $chunkIndex}""")
                    }

                    else -> {
                        sendJsonResponse(output, 404, """{"error": "Not found"}""")
                    }
                }

                socket.close()
            } catch (e: Exception) {
                Log.e(TAG, "Connection error: ${e.message}")
                try { socket.close() } catch (_: Exception) {}
            }
        }
    }

    private fun readBody(input: InputStream, length: Int): String {
        if (length <= 0) return ""
        val buffer = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(buffer, read, length - read)
            if (n == -1) break
            read += n
        }
        return String(buffer, 0, read)
    }

    private fun readBinaryBody(input: InputStream, length: Int): ByteArray {
        if (length <= 0) return ByteArray(0)
        val buffer = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(buffer, read, length - read)
            if (n == -1) break
            read += n
        }
        return buffer
    }

    private fun sendJsonResponse(output: OutputStream, status: Int, body: String) {
        val statusText = if (status == 200) "OK" else "Error"
        val response = "HTTP/1.1 $status $statusText\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: ${body.toByteArray().size}\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: close\r\n" +
                "\r\n" +
                body
        output.write(response.toByteArray())
        output.flush()
    }
}

/**
 * HTTP client for sending files to a LAN peer.
 */
class HttpTransferClient(private val baseUrl: String) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun getDeviceInfo(): DiscoveryInfo = withContext(Dispatchers.IO) {
        val connection = URL("$baseUrl/api/info").openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        val response = connection.inputStream.bufferedReader().readText()
        connection.disconnect()
        json.decodeFromString(response)
    }

    suspend fun sendHandshake(request: HandshakeRequest): HandshakeResponse = withContext(Dispatchers.IO) {
        val connection = URL("$baseUrl/api/handshake").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true

        val body = json.encodeToString(request)
        connection.outputStream.write(body.toByteArray())
        connection.outputStream.flush()

        val response = connection.inputStream.bufferedReader().readText()
        connection.disconnect()
        json.decodeFromString(response)
    }

    suspend fun sendChunk(
        fileId: String,
        chunkIndex: Int,
        data: ByteArray,
        chunkHash: String
    ) = withContext(Dispatchers.IO) {
        val connection = URL("$baseUrl/api/upload/$fileId").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/octet-stream")
        connection.setRequestProperty("x-chunk-index", chunkIndex.toString())
        connection.setRequestProperty("x-chunk-hash", chunkHash)
        connection.doOutput = true

        connection.outputStream.write(data)
        connection.outputStream.flush()

        val responseCode = connection.responseCode
        connection.disconnect()

        if (responseCode != 200) {
            throw IOException("Upload failed with status $responseCode")
        }
    }

    suspend fun sendFile(
        file: File,
        metadata: FileMetadata,
        onProgress: (Long, Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        val input = RandomAccessFile(file, "r")
        var bytesSent = 0L

        try {
            for (i in 0 until metadata.totalChunks) {
                val offset = i.toLong() * metadata.chunkSize
                val length = minOf(metadata.chunkSize.toLong(), metadata.fileSize - offset).toInt()
                val buffer = ByteArray(length)

                input.seek(offset)
                input.readFully(buffer)

                val hash = MessageDigest.getInstance("SHA-256")
                    .digest(buffer)
                    .joinToString("") { "%02x".format(it) }

                sendChunk(metadata.fileId, i, buffer, hash)

                bytesSent += length
                onProgress(bytesSent, metadata.fileSize)
            }
        } finally {
            input.close()
        }
    }
}
