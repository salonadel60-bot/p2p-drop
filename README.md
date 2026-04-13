# P2P Drop — Cross-Platform P2P File Transfer Ecosystem

> AirDrop + SHAREit + Snapdrop + Nearby Share — unified, open-source, no central server required.

**Transfer files directly between any combination of Android, Desktop (Windows/macOS/Linux), and Web browsers** over local network or WebRTC peer-to-peer connections.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    P2P Drop Ecosystem                    │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│  Shared  │   Web    │ Desktop  │ Android  │  Signaling  │
│   Core   │   App    │   App    │   App    │   Server    │
│  (TS)    │ (Vite)   │(Electron)│ (Kotlin) │   (WS)      │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│              Multi-Layer Network Strategy                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │  WebRTC  │  │ LAN HTTP │  │   Direct Socket      │   │
│  │ (STUN/   │  │  (Ktor/  │  │ (FileChannel.        │   │
│  │  DTLS)   │  │ Express) │  │  transferTo)         │   │
│  └──────────┘  └──────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description | Tech |
|---------|-------------|------|
| `@p2p-drop/core` | Shared protocol, transfer engine, crypto, discovery, identity | TypeScript |
| `@p2p-drop/web` | Browser-based P2P file transfer | Vite + WebRTC |
| `@p2p-drop/desktop` | Desktop application | Electron + Express + mDNS |
| `@p2p-drop/signaling` | Lightweight signaling server for WebRTC | WebSocket (ws) |
| `android/` | Android application | Kotlin + Jetpack Compose + NSD |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 8

### Install & Build

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Or build individually
npm run build:core
npm run build:web
npm run build:desktop
npm run build:signaling
```

### Run the Web App

```bash
npm run dev:web
# Opens at http://localhost:3000
# Open in multiple tabs to see peer discovery via BroadcastChannel
```

### Run the Desktop App

```bash
npm run dev:desktop
# Launches Electron window with mDNS discovery
```

### Run the Signaling Server

```bash
npm run dev:signaling
# Runs on port 8080 (configurable via PORT env)
# Health check: http://localhost:8080/health
```

### Run the Android App

```bash
cd packages/android
./gradlew assembleDebug
# Install on device: adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Network Strategy (Multi-Layer)

The system automatically selects the best transport:

### Layer 1 — WebRTC (Browser Compatibility)
- Peer-to-peer via STUN servers
- DataChannel for file transfer
- Works across networks with signaling server
- DTLS encryption built-in

### Layer 2 — LAN HTTP (Ktor/Express)
- Local HTTP server on sender
- Chunked streaming upload/download
- Works without internet
- Optimal for Desktop ↔ Android on same network

### Layer 3 — Direct Socket (High Performance)
- Native socket connections for Android/Desktop
- Zero-copy transfers via `FileChannel.transferTo()`
- Highest throughput on local network

**Auto-selection priority:** Direct Socket > LAN HTTP > Wi-Fi Direct > WebRTC

---

## Protocol Specification

### Universal Handshake

```json
{
  "type": "handshake-request",
  "version": "1.0.0",
  "sender": {
    "deviceId": "uuid-v4",
    "deviceName": "Pixel 8 Pro",
    "platform": "android",
    "capabilities": ["lan-http", "direct-socket", "wifi-direct", "webrtc"],
    "publicKeyFingerprint": "AB:CD:EF:..."
  },
  "files": [
    {
      "fileId": "uuid-v4",
      "fileName": "photo.jpg",
      "mimeType": "image/jpeg",
      "fileSize": 4521984,
      "sha256": "abc123...",
      "chunkSize": 262144,
      "totalChunks": 18
    }
  ],
  "sessionPublicKey": "base64...",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Transfer Engine Features

- **Chunked transfer** — configurable 16KB to 4MB chunks
- **Resume support** — receiver tracks received chunks, sender resumes from gaps
- **Parallel chunks** — up to 8 concurrent chunk transmissions
- **Integrity validation** — SHA-256 per-chunk and per-file verification
- **Adaptive engine** — dynamically adjusts chunk size and parallelism based on speed

---

## Discovery System

### Android
- **NSD (Network Service Discovery)** — mDNS/DNS-SD based
- **HTTP Probing** — scans local subnet for P2P Drop servers
- **Wi-Fi Direct** — direct device-to-device without router

### Desktop
- **mDNS/Bonjour** — via `bonjour-service` package
- **LAN HTTP** — advertises on configurable port (default 53317)

### Web
- **BroadcastChannel** — same-origin tab discovery
- **WebSocket Signaling** — cross-network via signaling server
- **QR Code** — scan to connect
- **Manual Link** — share pairing URL

---

## Pairing Methods

1. **QR Code** — Generate/scan QR code containing device info and endpoint
2. **Link-based** — Share a URL that encodes pairing data (like Snapdrop)
3. **Auto-discovery** — Automatic detection on same network via mDNS/NSD

---

## Security

- **ECDH (P-256)** key exchange for session encryption
- **AES-256-GCM** for data encryption
- **SHA-256** integrity verification per chunk and per file
- **DTLS** for WebRTC data channels (built into browser)
- **TLS** for LAN HTTP transfers
- Device trust model with fingerprint verification

---

## Storage

| Platform | Strategy |
|----------|----------|
| Android | Scoped Storage (`getExternalFilesDir`) |
| Desktop | Native filesystem (configurable save directory) |
| Web | File System Access API / Blob download fallback |

---

## UI

### Web — Snapdrop-inspired
- Dark theme with gradient accents
- Drag & drop file selection
- Real-time peer discovery animation
- Transfer progress with speed/ETA
- QR code pairing display
- Responsive (mobile + desktop browsers)

### Desktop — Electron
- Native system tray integration
- File dialog for send/receive
- mDNS peer auto-discovery
- Transfer progress notifications
- Runs in background

### Android — Material You
- Jetpack Compose UI
- Dynamic color theming
- Peer grid with platform icons
- Transfer progress cards
- Share intent integration (receive files from other apps)
- Foreground service for background transfers

---

## Performance Targets

| Transport | Target Speed | Notes |
|-----------|-------------|-------|
| LAN HTTP | 50-100 MB/s | Native socket I/O |
| Direct Socket | 80-150 MB/s | Zero-copy with FileChannel |
| WebRTC | 5-30 MB/s | Browser DataChannel limits |

---

## Project Structure

```
p2p-drop/
├── packages/
│   ├── core/                          # Shared TypeScript core
│   │   └── src/
│   │       ├── protocol/              # Protocol types & serialization
│   │       ├── transfer/              # Transfer engine (sender/receiver)
│   │       ├── crypto/                # ECDH + AES-256-GCM encryption
│   │       ├── discovery/             # Discovery interfaces & utilities
│   │       └── identity/              # Device identity management
│   ├── web/                           # Web application
│   │   ├── src/
│   │   │   ├── webrtc/                # WebRTC signaling & peer connection
│   │   │   ├── ui/                    # UI renderer & file handler
│   │   │   └── app.ts                 # Main application
│   │   ├── index.html
│   │   └── vite.config.ts
│   ├── desktop/                       # Electron desktop application
│   │   └── src/
│   │       ├── main/                  # Electron main process
│   │       ├── renderer/              # Electron renderer (UI)
│   │       └── network/               # LAN server + mDNS discovery
│   ├── signaling/                     # WebSocket signaling server
│   │   └── src/server.ts
│   └── android/                       # Android application
│       └── app/src/main/
│           ├── java/com/p2pdrop/
│           │   ├── model/             # Data models
│           │   ├── network/           # HTTP transfer client/server
│           │   ├── discovery/         # NSD discovery service
│           │   ├── transfer/          # Foreground transfer service
│           │   └── ui/                # Jetpack Compose UI
│           ├── res/                   # Android resources
│           └── AndroidManifest.xml
├── package.json                       # Workspace root
├── tsconfig.base.json                 # Shared TypeScript config
└── README.md
```

---

## Cross-Platform Interoperability Matrix

| Sender → Receiver | Transport | Discovery |
|-------------------|-----------|-----------|
| Android → Android | LAN HTTP / Direct Socket | NSD / HTTP Probe |
| Android → Desktop | LAN HTTP | NSD ↔ mDNS |
| Android → Web | WebRTC | Signaling Server |
| Desktop → Desktop | LAN HTTP / Direct Socket | mDNS |
| Desktop → Android | LAN HTTP | mDNS ↔ NSD |
| Desktop → Web | WebRTC | Signaling / BroadcastChannel |
| Web → Web | WebRTC | BroadcastChannel / Signaling |
| Web → Desktop | WebRTC | Signaling Server |
| Web → Android | WebRTC | Signaling Server |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Signaling server port |
| `P2P_HTTP_PORT` | `53317` | LAN HTTP server port |
| `P2P_SOCKET_PORT` | `53318` | Direct socket port |

### Web App URL Parameters

| Parameter | Description |
|-----------|-------------|
| `?signaling=ws://host:8080` | Connect to signaling server |
| `#pair=<base64>` | Auto-connect to a peer via pairing data |

---

## Development

```bash
# Type check all packages
npm run typecheck

# Lint all packages
npm run lint

# Build everything
npm run build
```

---

## License

MIT
