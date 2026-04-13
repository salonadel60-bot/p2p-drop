# P2P Drop

## Overview
Cross-platform, decentralized peer-to-peer file transfer ecosystem — similar to AirDrop, SHAREit, and Snapdrop. Enables direct P2P file sharing between devices (Web, Desktop, Android) without a central server.

## Architecture
This is a **npm monorepo** using npm workspaces with the following packages:

- **`packages/core`** — Shared TypeScript library: protocol definitions, crypto (ECDH + AES-256-GCM), file transfer engine, identity management
- **`packages/web`** — Browser-based client using Vite + WebRTC + BroadcastChannel (for same-origin tab discovery)
- **`packages/signaling`** — Lightweight WebSocket signaling server for WebRTC peer discovery across networks
- **`packages/desktop`** — Electron desktop app (not included in Replit workflows)
- **`packages/android`** — Native Android app using Kotlin + Jetpack Compose (not included in Replit workflows)

## Tech Stack
- **Frontend:** Vite 5, TypeScript, WebRTC Data Channels
- **Signaling Server:** Node.js, `ws` (WebSockets)
- **Crypto:** ECDH P-256 key exchange, AES-256-GCM encryption, SHA-256 integrity
- **Discovery:** BroadcastChannel (same-origin tabs), WebSocket signaling (cross-network), mDNS/NSD (LAN - desktop/Android only)

## Workflows
- **Start application** — Runs the web frontend dev server (`npm run dev:web`) on port 5000
- **Signaling Server** — Runs the WebSocket signaling server (`npm run dev:signaling`) on port 3001

## Key Commands
```bash
npm install              # Install all workspace dependencies
npm run build:core       # Build shared core library (required before other builds)
npm run build:web        # Build web frontend
npm run build:signaling  # Build signaling server
npm run dev:web          # Start web dev server (port 5000)
npm run dev:signaling    # Start signaling server (port 3001)
```

## Replit Migration Status
- Dependencies have been installed for the npm workspace.
- The Replit workflows run the web app and signaling server separately.
- Vite is configured for Replit preview access with `host: '0.0.0.0'` and `allowedHosts: true`.

## Deployment
- Configured as a **static** deployment
- Build: `npm run build:core && npm run build:web`
- Public directory: `packages/web/dist`
- The signaling server would need a separate VM deployment for production cross-network WebRTC support

## How It Works
1. Each browser tab gets a unique device identity stored in sessionStorage
2. Same-origin tabs discover each other via BroadcastChannel
3. Cross-network peers use the WebSocket signaling server (pass `?signaling=ws://...` in URL)
4. WebRTC Data Channels handle the actual file transfer
5. Files are encrypted end-to-end with ECDH + AES-256-GCM
