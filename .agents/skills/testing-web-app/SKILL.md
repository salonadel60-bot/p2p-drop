# P2P Drop Web App — Testing Skill

## Setup

```bash
# Install dependencies and build all packages
npm install && npm run build

# Start the web dev server (Vite, serves on localhost:3000)
npm run dev:web
```

Optionally, start the signaling server for cross-network WebRTC testing:
```bash
npm run dev:signaling  # WebSocket signaling on localhost:8080
```

## Known Issues & Workarounds

### Shared localStorage Identity (may be fixed in the future)
Both browser tabs on the same origin share `localStorage`, so `getOrCreateIdentity()` returns the same `deviceId`. The BroadcastChannel signaling self-filter (`signaling.ts:89`) discards messages from the same `deviceId`, preventing peer discovery.

**Workaround:** In the second tab's browser console, run:
```js
localStorage.removeItem('p2p-drop:device-identity');
```
Then reload the tab. It will generate a new identity with a different `deviceId`.

Alternatively, use a Chrome incognito window (separate localStorage context) for the second tab — but note that BroadcastChannel does NOT work across regular/incognito windows.

### Transport Mismatch in File Transfer (may be fixed in the future)
In `packages/web/src/app.ts:createPeerConnection()`, a dummy `WebRTCTransport` is created with `null` connection (line ~187) and receives incoming chunk/control events. A real transport is created later and stored in `peer.transport`. `FileSender`/`FileReceiver` register handlers on `peer.transport` (real), but events fire on the dummy. This causes file transfers to stall — sender at "TRANSFERRING", receiver at "PENDING".

Until this is fixed, file transfer completion cannot be tested.

## Testing Procedure

### 1. UI Loading
- Open `http://localhost:3000` in Chrome
- Verify: gradient header "P2P Drop", device badge with globe icon and name like "Browser-XXXX", "NEARBY DEVICES" section, drag & drop zone, QR code pairing section, footer

### 2. Peer Discovery (requires identity workaround)
- Open a second tab at `http://localhost:3000`
- Apply the localStorage workaround (see above)
- Wait ~5 seconds for BroadcastChannel heartbeat
- Both tabs should show each other's peer cards with globe icon, device name, "web" platform, "Available" status
- A notification toast "[device name] joined" should appear

### 3. File Selection Guard
- Without selecting a peer, click the drop zone and select any file
- A yellow warning notification should appear: "Please select a device first, then drop files"

### 4. WebRTC Connection
- Click a peer card in Tab A
- Peer card should get a blue highlight border (selected state)
- Green notification: "Connected to [peer name]"
- Peer status changes to "Connected"

### 5. File Transfer
- With peer connected, click drop zone and select a file
- Or use console: `window.p2pDrop.sendFiles([new File([new TextEncoder().encode('test')], 'test.txt')], peerId)`
- Sender should show transfer entry with upload icon, filename, size, destination
- Receiver should show transfer entry with download icon
- **Note:** Transfer may stall due to transport mismatch bug (see Known Issues)

## Debugging Tips

### Check peer connection state via console:
```js
const app = window.p2pDrop;
for (const [id, state] of app.peers.entries()) {
  console.log('Peer:', id.substring(0, 8), 'device:', state.device.deviceName, 
    'connected:', state.connection?.connected, 'transport:', state.transport ? 'exists' : 'null');
}
```

### Key source files:
- `packages/web/src/app.ts` — main app logic, peer connection, file transfer
- `packages/web/src/webrtc/signaling.ts` — BroadcastChannel + WebSocket signaling
- `packages/web/src/webrtc/peer-connection.ts` — WebRTC connection management
- `packages/web/src/ui/renderer.ts` — UI rendering and event handlers
- `packages/core/src/identity/device.ts` — device identity generation and storage
- `packages/core/src/transfer/engine.ts` — chunked transfer engine (FileSender/FileReceiver)

## Devin Secrets Needed
None — the web app runs entirely locally with no external services.
