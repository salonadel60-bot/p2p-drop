package com.p2pdrop.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.p2pdrop.model.DeviceIdentity
import com.p2pdrop.model.DiscoveredPeer
import com.p2pdrop.model.DiscoveryInfo
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * NSD (Network Service Discovery) based peer discovery.
 * Discovers P2P Drop peers on the local network using mDNS/DNS-SD.
 */
class NsdDiscoveryService(private val context: Context) {

    companion object {
        private const val TAG = "NsdDiscovery"
        private const val SERVICE_TYPE = "_p2p-drop._tcp."
        private const val SERVICE_NAME_PREFIX = "P2PDrop-"
        const val DEFAULT_PORT = 53317
    }

    private val nsdManager: NsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val _peers = MutableStateFlow<List<DiscoveredPeer>>(emptyList())
    val peers: StateFlow<List<DiscoveredPeer>> = _peers

    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isDiscovering = false

    /**
     * Register this device as a P2P Drop service on the network.
     */
    fun registerService(identity: DeviceIdentity, port: Int) {
        val serviceInfo = NsdServiceInfo().apply {
            serviceName = "$SERVICE_NAME_PREFIX${identity.deviceId.take(8)}"
            serviceType = SERVICE_TYPE
            setPort(port)
            setAttribute("deviceId", identity.deviceId)
            setAttribute("deviceName", identity.deviceName)
            setAttribute("platform", identity.platform)
            setAttribute("capabilities", identity.capabilities.joinToString(","))
            setAttribute("fingerprint", identity.publicKeyFingerprint)
            setAttribute("ready", "1")
        }

        registrationListener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "Service registered: ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Registration failed: $errorCode")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                Log.i(TAG, "Service unregistered")
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Unregistration failed: $errorCode")
            }
        }

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
    }

    /**
     * Start discovering P2P Drop peers on the network.
     */
    fun startDiscovery() {
        if (isDiscovering) return

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.i(TAG, "Discovery started")
                isDiscovering = true
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType == SERVICE_TYPE) {
                    resolveService(serviceInfo)
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "Service lost: ${serviceInfo.serviceName}")
                val peers = _peers.value.toMutableList()
                peers.removeAll { it.device.deviceName == serviceInfo.serviceName.removePrefix(SERVICE_NAME_PREFIX) }
                _peers.value = peers
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.i(TAG, "Discovery stopped")
                isDiscovering = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Start discovery failed: $errorCode")
                isDiscovering = false
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Stop discovery failed: $errorCode")
            }
        }

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
    }

    /**
     * Also probe known LAN addresses for P2P Drop HTTP servers.
     */
    fun startHttpProbing() {
        scope.launch {
            while (isActive) {
                probeLocalNetwork()
                delay(5000)
            }
        }
    }

    private suspend fun probeLocalNetwork() {
        val localIp = getLocalIpAddress() ?: return
        val subnet = localIp.substringBeforeLast(".")

        // Probe common addresses in parallel
        coroutineScope {
            (1..254).map { i ->
                async {
                    val ip = "$subnet.$i"
                    if (ip != localIp) {
                        tryProbeHost(ip, DEFAULT_PORT)
                    }
                }
            }.awaitAll()
        }
    }

    private suspend fun tryProbeHost(host: String, port: Int) {
        try {
            withTimeout(1000) {
                val url = "http://$host:$port/api/info"
                val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                connection.connectTimeout = 800
                connection.readTimeout = 800
                connection.requestMethod = "GET"

                if (connection.responseCode == 200) {
                    val response = connection.inputStream.bufferedReader().readText()
                    val info = json.decodeFromString<DiscoveryInfo>(response)

                    val peer = DiscoveredPeer(
                        device = info.device,
                        address = host,
                        port = port,
                        method = "http-probe"
                    )

                    val currentPeers = _peers.value.toMutableList()
                    currentPeers.removeAll { it.device.deviceId == info.device.deviceId }
                    currentPeers.add(peer)
                    _peers.value = currentPeers
                }
                connection.disconnect()
            }
        } catch (_: Exception) {
            // Host not available
        }
    }

    private fun resolveService(serviceInfo: NsdServiceInfo) {
        nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Resolve failed: $errorCode")
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                val attrs = info.attributes
                val deviceId = attrs["deviceId"]?.let { String(it) } ?: return
                val deviceName = attrs["deviceName"]?.let { String(it) } ?: info.serviceName
                val platform = attrs["platform"]?.let { String(it) } ?: "unknown"
                val capabilities = attrs["capabilities"]?.let { String(it) }?.split(",") ?: listOf("lan-http")
                val fingerprint = attrs["fingerprint"]?.let { String(it) } ?: ""

                val peer = DiscoveredPeer(
                    device = DeviceIdentity(
                        deviceId = deviceId,
                        deviceName = deviceName,
                        platform = platform,
                        capabilities = capabilities,
                        publicKeyFingerprint = fingerprint
                    ),
                    address = info.host.hostAddress ?: return,
                    port = info.port,
                    method = "nsd"
                )

                val currentPeers = _peers.value.toMutableList()
                currentPeers.removeAll { it.device.deviceId == deviceId }
                currentPeers.add(peer)
                _peers.value = currentPeers

                Log.i(TAG, "Peer resolved: $deviceName at ${peer.address}:${peer.port}")
            }
        })
    }

    fun stopDiscovery() {
        if (isDiscovering) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener)
            } catch (_: Exception) {}
        }
    }

    fun unregisterService() {
        try {
            registrationListener?.let { nsdManager.unregisterService(it) }
        } catch (_: Exception) {}
    }

    fun destroy() {
        scope.cancel()
        stopDiscovery()
        unregisterService()
    }

    private fun getLocalIpAddress(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                if (networkInterface.isLoopback || !networkInterface.isUp) continue
                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Exception) {}
        return null
    }
}
