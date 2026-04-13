/**
 * P2P Drop Web UI Renderer.
 * Builds a Snapdrop-inspired UI with device discovery, drag & drop, and transfer progress.
 */

import type { DeviceIdentity, FileMetadata, ProgressUpdate, TransferState, TransferDirection } from '@p2p-drop/core';

interface UICallbacks {
  onFilesSelected: (files: FileList | File[], peerId: string) => void;
  onPeerClick: (peerId: string) => void;
}

let selectedPeerId: string | null = null;
let callbacks: UICallbacks;

const platformIcons: Record<string, string> = {
  'web': '🌐',
  'android': '📱',
  'desktop-windows': '💻',
  'desktop-macos': '🖥',
  'desktop-linux': '🐧',
};

/**
 * Render the main UI.
 */
export function renderUI(identity: DeviceIdentity, cbs: UICallbacks): void {
  callbacks = cbs;
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="container">
      <header>
        <h1>P2P Drop</h1>
        <p class="subtitle">Secure peer-to-peer file transfer</p>
        <div class="device-info">
          <span class="device-icon">${platformIcons[identity.platform] || '📡'}</span>
          <span class="device-name">${escapeHtml(identity.deviceName)}</span>
        </div>
      </header>

      <main>
        <section class="peers-section">
          <h2>Nearby Devices</h2>
          <div id="peers-container" class="peers-grid">
            <div class="empty-state">
              <div class="pulse-ring"></div>
              <p>Looking for nearby devices...</p>
              <p class="hint">Open P2P Drop in another tab or device on the same network</p>
            </div>
          </div>
        </section>

        <section class="drop-zone-section">
          <div id="drop-zone" class="drop-zone">
            <div class="drop-zone-content">
              <div class="drop-icon">📁</div>
              <p>Drag & drop files here</p>
              <p class="hint">or click to select files</p>
              <input type="file" id="file-input" multiple style="display:none" />
            </div>
          </div>
        </section>

        <section class="transfers-section" id="transfers-section" style="display:none">
          <h2>Transfers</h2>
          <div id="transfers-list" class="transfers-list"></div>
        </section>

        <section class="pairing-section">
          <h2>Pairing</h2>
          <div class="pairing-options">
            <div class="qr-container">
              <canvas id="qr-canvas" width="200" height="200"></canvas>
              <p class="hint">Scan to connect</p>
            </div>
            <div class="link-container">
              <p>Share this link:</p>
              <code id="pairing-url" class="pairing-link"></code>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <p>Files are transferred directly between devices — no server involved</p>
      </footer>
    </div>

    <div id="notification-container" class="notification-container"></div>
  `;

  setupDropZone();
  setupFileInput();
}

/**
 * Update the peer list display.
 */
export function updatePeerList(peers: Array<{ id: string; device: DeviceIdentity; connected: boolean }>): void {
  const container = document.getElementById('peers-container');
  if (!container) return;

  if (peers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="pulse-ring"></div>
        <p>Looking for nearby devices...</p>
        <p class="hint">Open P2P Drop in another tab or device on the same network</p>
      </div>
    `;
    return;
  }

  container.innerHTML = peers.map(peer => `
    <div class="peer-card ${selectedPeerId === peer.id ? 'selected' : ''} ${peer.connected ? 'connected' : ''}"
         data-peer-id="${escapeHtml(peer.id)}"
         role="button"
         tabindex="0">
      <div class="peer-icon">${platformIcons[peer.device.platform] || '📡'}</div>
      <div class="peer-name">${escapeHtml(peer.device.deviceName)}</div>
      <div class="peer-platform">${escapeHtml(peer.device.platform)}</div>
      <div class="peer-status ${peer.connected ? 'status-connected' : 'status-available'}">
        ${peer.connected ? 'Connected' : 'Available'}
      </div>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.peer-card').forEach(card => {
    card.addEventListener('click', () => {
      const peerId = (card as HTMLElement).dataset.peerId!;
      selectedPeerId = peerId;
      callbacks.onPeerClick(peerId);

      // Update selection visual
      container.querySelectorAll('.peer-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

/**
 * Add a transfer entry to the transfers list.
 */
export function addTransferEntry(
  metadata: FileMetadata,
  direction: TransferDirection,
  peerName: string
): void {
  const section = document.getElementById('transfers-section');
  const list = document.getElementById('transfers-list');
  if (!section || !list) return;

  section.style.display = 'block';

  const entry = document.createElement('div');
  entry.className = 'transfer-entry';
  entry.id = `transfer-${metadata.fileId}`;
  entry.innerHTML = `
    <div class="transfer-header">
      <span class="transfer-direction">${direction === 'send' ? '⬆️' : '⬇️'}</span>
      <span class="transfer-filename">${escapeHtml(metadata.fileName)}</span>
      <span class="transfer-size">${formatSize(metadata.fileSize)}</span>
      <span class="transfer-peer">${direction === 'send' ? 'to' : 'from'} ${escapeHtml(peerName)}</span>
    </div>
    <div class="transfer-progress">
      <div class="progress-bar">
        <div class="progress-fill" id="progress-${metadata.fileId}" style="width: 0%"></div>
      </div>
      <div class="transfer-stats">
        <span class="transfer-speed" id="speed-${metadata.fileId}">Waiting...</span>
        <span class="transfer-eta" id="eta-${metadata.fileId}"></span>
        <span class="transfer-state" id="state-${metadata.fileId}">pending</span>
      </div>
    </div>
  `;

  list.prepend(entry);
}

/**
 * Update transfer progress bar.
 */
export function updateTransferProgress(fileId: string, update: ProgressUpdate): void {
  const progressBar = document.getElementById(`progress-${fileId}`);
  const speedEl = document.getElementById(`speed-${fileId}`);
  const etaEl = document.getElementById(`eta-${fileId}`);

  if (progressBar) {
    const percent = (update.bytesTransferred / update.totalBytes) * 100;
    progressBar.style.width = `${percent.toFixed(1)}%`;
  }
  if (speedEl) {
    speedEl.textContent = `${formatSize(update.speed)}/s`;
  }
  if (etaEl) {
    etaEl.textContent = update.eta > 0 ? `ETA: ${formatTime(update.eta)}` : '';
  }
}

/**
 * Update transfer state display.
 */
export function updateTransferState(fileId: string, state: TransferState): void {
  const stateEl = document.getElementById(`state-${fileId}`);
  const entry = document.getElementById(`transfer-${fileId}`);

  if (stateEl) {
    stateEl.textContent = state;
    stateEl.className = `transfer-state state-${state}`;
  }
  if (entry) {
    entry.className = `transfer-entry ${state}`;
  }
}

/**
 * Show a notification toast.
 */
export function showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  container.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.classList.add('notification-exit');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// --- Private helpers ---

function setupDropZone(): void {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const files = (e as DragEvent).dataTransfer?.files;
    if (files && files.length > 0) {
      handleFilesSelected(files);
    }
  });

  dropZone.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
}

function setupFileInput(): void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  if (!input) return;

  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) {
      handleFilesSelected(input.files);
      input.value = ''; // Reset for next selection
    }
  });
}

function handleFilesSelected(files: FileList): void {
  if (!selectedPeerId) {
    showNotification('Please select a device first, then drop files', 'warning');
    return;
  }
  callbacks.onFilesSelected(files, selectedPeerId);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
