# Testing P2P Drop Web UI

## Overview
This skill covers testing the P2P Drop web application's Futuristic Radar Scanner UI, including the canvas-based radar, theme system, settings panel, i18n (Arabic/English), peer discovery, and visual effects.

## Prerequisites

### Dev Server
```bash
cd /home/ubuntu/repos/p2p-drop
npm install
npm run dev:web   # Starts Vite dev server at localhost:3003
```

### Browser
Chrome should already be running. If not:
```bash
DISPLAY=:0 nohup google-chrome-stable --no-first-run --no-default-browser-check --remote-debugging-port=29229 http://localhost:3003 &
```

Maximize before recording:
```bash
wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
```

## Devin Secrets Needed
No secrets required — the web app runs entirely locally.

## Key Test Areas

### 1. Radar Canvas Animation
- Take two screenshots 3+ seconds apart
- Verify the scanning beam has rotated (it moves at `beamAngle += 0.012` per frame, ~360° every 8.7s)
- Check for concentric grid rings, cross/diagonal lines, and "YOU" marker at center

### 2. Theme Toggle
- Click the moon/sun icon next to the device badge
- Dark mode: background `#050510`, cyan accents (`#00e5ff`), icon shows ☀️
- Light mode: background `#f0f4f8`, teal accents (`#0891b2`), icon shows 🌙
- Theme persists in `localStorage` key `p2p-drop-settings`

### 3. Settings Panel
- Click the ⚙️ gear icon to open
- Panel should have glassmorphism blur effect (`backdrop-filter: blur(24px)`)
- 4 setting groups: Theme, Language, Download Location, Stealth Mode
- Close via X button or clicking outside the overlay

### 4. Arabic Language (RTL)
- In settings, click "العربية" button
- Verify `dir="rtl"` and `lang="ar"` set on `<html>` element
- All UI strings should be in Arabic (settings rebuilds UI on language change)
- Layout should be right-aligned
- Key Arabic strings to verify: "الإعدادات" (Settings), "اسحب وأفلت الملفات هنا" (Drag & drop), "الاقتران" (Pairing)

### 5. Peer Discovery
- Open two tabs of `localhost:3003`
- Each tab gets unique identity via `SessionStorageAdapter` (not shared `localStorage`)
- Tabs discover each other via `BroadcastChannel` within ~6 seconds
- Discovered device appears on radar with globe SVG icon and pulse rings
- Hover shows tooltip with device name, platform ("WEB"), and connection status

### 6. Particle Background
- Most visible in dark mode
- Look for subtle cyan dots on the deep dark background
- 50 particles with random velocity vectors
- Connection lines drawn between particles < 120px apart
- Element: `#particle-canvas` created by `renderer.ts`

## Known Issues & Workarounds

### CDP Connection
- Chrome DevTools Protocol at `localhost:29229` might not be accessible for programmatic DOM inspection
- Workaround: Use visual verification via screenshots and zoom regions
- If CDP works, you can verify DOM attributes like `data-theme`, `dir`, `lang` programmatically

### Playwright
- Playwright is not installed by default in the project
- If needed: `npm install playwright && npx playwright install chromium`
- Connect via CDP: `chromium.connectOverCDP('http://127.0.0.1:29229')` (use 127.0.0.1, not localhost)

### Signaling Server
- The signaling server (`localhost:8080`) is NOT needed for same-origin tab-to-tab testing
- BroadcastChannel handles same-origin peer discovery
- Signaling server only needed for cross-origin or cross-device WebRTC connections

## File Locations
- UI renderer: `packages/web/src/ui/renderer.ts` (~872 lines)
- Styles: `packages/web/src/styles.css` (~1020 lines)
- App entry: `packages/web/src/app.ts`
- Vite config: `packages/web/vite.config.ts`

## Build & Typecheck
```bash
npm run build        # Build all packages
npm run typecheck    # TypeScript type checking
```
