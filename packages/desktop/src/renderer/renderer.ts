/**
 * Desktop Renderer Process.
 * Handles UI updates and user interactions via the preload API.
 */

export {};

interface P2PDropAPI {
  getIdentity(): Promise<{ deviceName: string; platform: string }>;
  getPeers(): Promise<Array<{ device: { deviceId: string; deviceName: string; platform: string }; address: string; httpPort: number }>>;
  onPeerDiscovered(callback: (peer: { device: { deviceId: string; deviceName: string; platform: string }; address: string; httpPort: number }) => void): void;
  onPeerLost(callback: (deviceId: string) => void): void;
  selectFiles(): Promise<string[]>;
  sendFiles(address: string, port: number, paths: string[]): Promise<{ success?: boolean; error?: string }>;
  onTransferRequest(callback: (request: { sender: { deviceName: string }; files: Array<{ fileId: string; fileName: string; fileSize: number }> }) => void): void;
  respondToTransfer(accepted: boolean): void;
  onTransferProgress(callback: (data: { fileId: string; bytesReceived: number; totalBytes: number }) => void): void;
  onSendProgress(callback: (data: { fileId: string; bytesSent: number; totalBytes: number; fileName: string }) => void): void;
  onTransferComplete(callback: (data: { fileId: string; filePath: string }) => void): void;
  onTransferError(callback: (data: { fileId: string; error: string }) => void): void;
  onIdentity(callback: (identity: { deviceName: string; platform: string }) => void): void;
}

declare global {
  interface Window {
    p2pDrop: P2PDropAPI;
  }
}

const api: P2PDropAPI = (window as Window & { p2pDrop: P2PDropAPI }).p2pDrop;

const platformIcons: Record<string, string> = {
  'web': '🌐',
  'android': '📱',
  'desktop-windows': '💻',
  'desktop-macos': '🖥',
  'desktop-linux': '🐧',
};

interface PeerInfo {
  device: { deviceId: string; deviceName: string; platform: string };
  address: string;
  httpPort: number;
}

let selectedPeer: PeerInfo | null = null;
const peers = new Map<string, PeerInfo>();
const transfers = new Map<string, { fileName: string; progress: number; status: string }>();

// Initialize
async function init(): Promise<void> {
  // Set up identity display
  api.onIdentity((identity: { deviceName: string; platform: string }) => {
    const badge = document.getElementById('device-badge');
    if (badge) {
      badge.textContent = `${platformIcons[identity.platform] || '📡'} ${identity.deviceName}`;
    }
  });

  // Try to get identity immediately
  try {
    const identity = await api.getIdentity();
    if (identity) {
      const badge = document.getElementById('device-badge');
      if (badge) {
        badge.textContent = `${platformIcons[identity.platform] || '📡'} ${identity.deviceName}`;
      }
    }
  } catch {
    // Will be set via onIdentity event
  }

  // Set up peer discovery
  api.onPeerDiscovered((peer: PeerInfo) => {
    peers.set(peer.device.deviceId, peer);
    renderPeers();
  });

  api.onPeerLost((deviceId: string) => {
    peers.delete(deviceId);
    if (selectedPeer?.device.deviceId === deviceId) {
      selectedPeer = null;
      updateSendButton();
    }
    renderPeers();
  });

  // Set up transfer events
  api.onTransferRequest((request: { sender: { deviceName: string }; files: Array<{ fileId: string; fileName: string; fileSize: number }> }) => {
    showTransferDialog(request);
  });

  api.onTransferProgress((data: { fileId: string; bytesReceived: number; totalBytes: number }) => {
    updateTransfer(data.fileId, data.bytesReceived / data.totalBytes, 'receiving');
  });

  api.onSendProgress((data: { fileId: string; bytesSent: number; totalBytes: number; fileName: string }) => {
    updateTransfer(data.fileId, data.bytesSent / data.totalBytes, 'sending');
    if (!transfers.has(data.fileId)) {
      transfers.set(data.fileId, { fileName: data.fileName, progress: 0, status: 'sending' });
      renderTransfers();
    }
  });

  api.onTransferComplete((_data: { fileId: string; filePath: string }) => {
    updateTransfer(_data.fileId, 1, 'completed');
  });

  api.onTransferError((data: { fileId: string; error: string }) => {
    updateTransfer(data.fileId, -1, `error: ${data.error}`);
  });

  // Set up send button
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  sendBtn.addEventListener('click', handleSendFiles);

  // Poll for peers initially
  try {
    const initialPeers = await api.getPeers();
    for (const peer of initialPeers) {
      peers.set(peer.device.deviceId, peer);
    }
    renderPeers();
  } catch {
    // Will be populated via events
  }
}

function renderPeers(): void {
  const container = document.getElementById('peers')!;

  if (peers.size === 0) {
    container.innerHTML = '<div class="empty-peers">Scanning for devices on your network...</div>';
    return;
  }

  container.innerHTML = Array.from(peers.values()).map(peer => `
    <div class="peer-card ${selectedPeer?.device.deviceId === peer.device.deviceId ? 'selected' : ''}"
         data-device-id="${escapeHtml(peer.device.deviceId)}">
      <div class="peer-icon">${platformIcons[peer.device.platform] || '📡'}</div>
      <div class="peer-name">${escapeHtml(peer.device.deviceName)}</div>
      <div class="peer-platform">${escapeHtml(peer.device.platform)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.peer-card').forEach(card => {
    card.addEventListener('click', () => {
      const deviceId = (card as HTMLElement).dataset.deviceId!;
      selectedPeer = peers.get(deviceId) || null;
      renderPeers();
      updateSendButton();
    });
  });
}

function updateSendButton(): void {
  const btn = document.getElementById('send-btn') as HTMLButtonElement;
  btn.disabled = !selectedPeer;
  btn.textContent = selectedPeer
    ? `Send Files to ${selectedPeer.device.deviceName}`
    : 'Select a Device First';
}

async function handleSendFiles(): Promise<void> {
  if (!selectedPeer) return;

  const filePaths = await api.selectFiles();
  if (!filePaths || filePaths.length === 0) return;

  const result = await api.sendFiles(
    selectedPeer.address,
    selectedPeer.httpPort,
    filePaths
  );

  if (result.error) {
    alert(`Transfer failed: ${result.error}`);
  }
}

function showTransferDialog(request: { sender: { deviceName: string }; files: Array<{ fileId: string; fileName: string; fileSize: number }> }): void {
  const container = document.getElementById('dialog-container')!;
  const totalSize = request.files.reduce((sum, f) => sum + f.fileSize, 0);
  const fileList = request.files.map(f => escapeHtml(f.fileName)).join(', ');

  container.innerHTML = `
    <div class="dialog-overlay">
      <div class="dialog">
        <h3>Incoming Transfer</h3>
        <p><strong>${escapeHtml(request.sender.deviceName)}</strong> wants to send you:<br/>
        ${fileList}<br/>
        Total: ${formatSize(totalSize)}</p>
        <div class="dialog-actions">
          <button class="dialog-btn reject" id="reject-btn">Decline</button>
          <button class="dialog-btn accept" id="accept-btn">Accept</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('accept-btn')!.addEventListener('click', () => {
    api.respondToTransfer(true);
    container.innerHTML = '';
    for (const file of request.files) {
      transfers.set(file.fileId, { fileName: file.fileName, progress: 0, status: 'receiving' });
    }
    renderTransfers();
  });

  document.getElementById('reject-btn')!.addEventListener('click', () => {
    api.respondToTransfer(false);
    container.innerHTML = '';
  });
}

function updateTransfer(fileId: string, progress: number, status: string): void {
  const existing = transfers.get(fileId);
  if (existing) {
    existing.progress = progress;
    existing.status = status;
  }
  renderTransfers();
}

function renderTransfers(): void {
  const container = document.getElementById('transfers')!;

  if (transfers.size === 0) {
    container.innerHTML = '<div class="empty-peers">No active transfers</div>';
    return;
  }

  container.innerHTML = Array.from(transfers.entries()).map(([_id, t]) => `
    <div class="transfer-item">
      <div class="transfer-info">
        <span>${t.fileName}</span>
        <span>${t.status}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${Math.max(0, t.progress * 100)}%"></div>
      </div>
      <div class="transfer-status">${t.progress >= 0 ? `${(t.progress * 100).toFixed(1)}%` : 'Error'}</div>
    </div>
  `).join('');
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

// Boot
init();
