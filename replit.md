# P2P Drop

## Overview
Cross-platform, decentralized peer-to-peer file transfer ecosystem — similar to AirDrop, SHAREit, and Snapdrop. Enables direct P2P file sharing between devices (Web, Desktop, Android) without a central server for file data. A lightweight signaling server is used only for live peer discovery and WebRTC negotiation.

## Architecture
This is a **npm monorepo** using npm workspaces with the following packages:

- **`packages/core`** — Shared TypeScript library: protocol definitions, crypto (ECDH + AES-256-GCM), file transfer engine, identity management
- **`packages/web`** — Browser-based client using Vite + WebRTC
- **`packages/signaling`** — Node.js server that serves the built web app in production and provides WebSocket signaling at `/signaling`
- **`packages/desktop`** — Electron desktop app (not included in Replit workflows)
- **`packages/android`** — Native Android app using Kotlin + Jetpack Compose (not included in Replit workflows)

## Tech Stack
- **Frontend:** Vite 5, TypeScript, WebRTC Data Channels, WebRTC media tracks
- **UI:** Canvas radar, jsQR camera scanner, enlarged QR pairing, click-to-copy pairing links, glassmorphism settings panel
- **Signaling Server:** Node.js, `ws` (WebSockets), static file serving for production
- **Crypto:** ECDH P-256 key exchange, AES-256-GCM encryption, SHA-256 integrity
- **Discovery:** WebSocket signaling for cross-device discovery; BroadcastChannel same-tab discovery is disabled by default and available only with `?localTabs=1`

## Workflows
- **Start application** — Runs the Vite frontend dev server (`npm run dev:web`) on port 5000 and proxies `/signaling` WebSocket traffic to the signaling workflow
- **Signaling Server** — Runs the WebSocket signaling server (`npm run dev:signaling`) on port 3001

## Key Commands
```bash
npm install              # Install all workspace dependencies
npm run build:core       # Build shared core library
npm run build:web        # Build web frontend
npm run build:signaling  # Build signaling/production server
npm run build:prod       # Build core, web, and signaling for deployment
npm run start:prod       # Start production server that serves web + signaling
npm run dev:web          # Start web dev server (port 5000)
npm run dev:signaling    # Start signaling server (port 3001)
```

## Current Web Features
- Radar-style peer discovery UI with animated canvas scanning and proximity-mapped device nodes.
- Radar devices always show a modern device-name badge instead of only showing names on hover.
- Automatic live cross-device discovery through same-origin WebSocket signaling.
- Selecting a radar device now sends a connection request that the other device must accept or reject before WebRTC connects.
- Text chat is available for the selected radar peer using the live signaling channel, with sent/received message bubbles.
- QR pairing modal powered by `jsQR` and enlarged QR generation for easier scanning.
- Short compact `#p=` pairing URLs with click-to-copy behavior on a shortened visible pairing link that still copies the full URL.
- P2P file transfer over encrypted WebRTC Data Channels.
- A smarter two-column workspace groups radar discovery beside chat, call controls, and file sending cards for a more compact experience.
- P2P media room controls for voice, video, and screen sharing between selected peers, including incoming call accept/reject prompts and separate local/remote video tiles.
- Settings for save-location UI, Arabic/English language, stealth mode, and dark/light mode.

## Replit Migration Status
- Dependencies have been installed for the npm workspace.
- The Replit workflows run the web app and signaling server separately in development.
- Vite is configured for Replit preview access with `host: '0.0.0.0'`, `allowedHosts: true`, and `/signaling` WebSocket proxying.
- The web client connects to `/signaling?room=public` automatically so different devices can discover each other live without relying on same-device browser tabs.

## Deployment
- Configured as an **autoscale** deployment so the WebSocket signaling server runs in production.
- Build: `npm run build:prod`
- Run: `npm run start:prod`
- The production server serves `packages/web/dist` and handles WebSocket signaling on the same domain at `/signaling`.

## How It Works
1. Each browser tab gets a unique device identity stored in sessionStorage.
2. The web app automatically connects to the live signaling endpoint on the same domain.
3. Devices announce themselves in the shared public room and appear on each other’s radar.
4. QR scanning refreshes or switches the signaling connection instead of stopping with a false “already connected” message.
5. WebRTC Data Channels handle encrypted file transfer directly between devices.
6. WebRTC media tracks handle selected-peer voice, video, and screen sharing.
7. Files are encrypted end-to-end with ECDH + AES-256-GCM.
