/**
 * Electron Main Process for P2P Drop Desktop.
 * Manages windows, system tray, LAN server, and mDNS discovery.
 */

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getOrCreateIdentity } from '@p2p-drop/core';
import type { DeviceIdentity, FileMetadata, HandshakeRequest, DiscoveryAnnouncement } from '@p2p-drop/core';
import { PROTOCOL_VERSION, DEFAULT_HTTP_PORT, computeOptimalChunkSize } from '@p2p-drop/core';
import { LANTransferServer, LANTransferClient } from '../network/lan-server.js';
import { MDNSDiscovery } from '../network/mdns-discovery.js';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let lanServer: LANTransferServer | null = null;
let mdnsDiscovery: MDNSDiscovery | null = null;
let deviceIdentity: DeviceIdentity | null = null;

/** File-based identity storage for desktop */
class FileIdentityStorage {
  private filePath: string;

  constructor() {
    const configDir = path.join(os.homedir(), '.p2p-drop');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.filePath = path.join(configDir, 'identity.json');
  }

  async get(key: string): Promise<string | null> {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, string>;
      return data[key] ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, string>;
    } catch {
      // File doesn't exist yet
    }
    data[key] = value;
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 650,
    minWidth: 500,
    minHeight: 450,
    title: 'P2P Drop',
    backgroundColor: '#0f0f23',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('P2P Drop');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray = null; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

async function startServices(): Promise<void> {
  // Initialize device identity
  const storage = new FileIdentityStorage();
  deviceIdentity = await getOrCreateIdentity(storage, os.hostname());

  // Start LAN HTTP server
  lanServer = new LANTransferServer(deviceIdentity, {
    onPeerConnected: (peer) => {
      mainWindow?.webContents.send('peer-connected', peer);
    },
    onTransferRequest: (request, respond) => {
      // Show dialog to accept/reject
      mainWindow?.show();
      mainWindow?.webContents.send('transfer-request', request);

      // Listen for response from renderer
      ipcMain.once('transfer-response', (_event, accepted: boolean) => {
        if (accepted) {
          const downloadsDir = path.join(os.homedir(), 'Downloads', 'P2P-Drop');
          if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
          }
          respond(true, downloadsDir);
        } else {
          respond(false);
        }
      });
    },
    onTransferProgress: (fileId, bytesReceived, totalBytes) => {
      mainWindow?.webContents.send('transfer-progress', { fileId, bytesReceived, totalBytes });
    },
    onTransferComplete: (fileId, filePath) => {
      mainWindow?.webContents.send('transfer-complete', { fileId, filePath });
    },
    onTransferError: (fileId, error) => {
      mainWindow?.webContents.send('transfer-error', { fileId, error });
    },
  });

  const port = await lanServer.start();

  // Start mDNS discovery
  mdnsDiscovery = new MDNSDiscovery();

  const announcement: DiscoveryAnnouncement = {
    type: 'discovery-announcement',
    device: deviceIdentity,
    httpPort: port,
    readyToReceive: true,
  };

  await mdnsDiscovery.startAnnouncing(announcement);
  await mdnsDiscovery.startScanning();

  mdnsDiscovery.onPeerDiscovered((peer) => {
    mainWindow?.webContents.send('peer-discovered', peer);
  });

  mdnsDiscovery.onPeerLost((deviceId) => {
    mainWindow?.webContents.send('peer-lost', deviceId);
  });

  // Send identity to renderer
  mainWindow?.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('identity', deviceIdentity);
  });
}

function setupIPC(): void {
  // Get device identity
  ipcMain.handle('get-identity', () => deviceIdentity);

  // Get discovered peers
  ipcMain.handle('get-peers', () => mdnsDiscovery?.getKnownPeers() ?? []);

  // Select files to send
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select files to send',
    });
    return result.filePaths;
  });

  // Send files to a peer
  ipcMain.handle('send-files', async (_event, peerAddress: string, peerPort: number, filePaths: string[]) => {
    if (!deviceIdentity) return { error: 'Not initialized' };

    const client = new LANTransferClient(`http://${peerAddress}:${peerPort}`);

    try {
      // Build file metadata (stream SHA-256 to avoid OOM on large files)
      const files: FileMetadata[] = [];
      for (const filePath of filePaths) {
        const stats = fs.statSync(filePath);
        const chunkSize = computeOptimalChunkSize(stats.size);
        const hash = await new Promise<string>((resolve, reject) => {
          const hasher = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath);
          stream.on('data', (chunk) => hasher.update(chunk));
          stream.on('end', () => resolve(hasher.digest('hex')));
          stream.on('error', reject);
        });

        files.push({
          fileId: crypto.randomUUID(),
          fileName: path.basename(filePath),
          mimeType: 'application/octet-stream',
          fileSize: stats.size,
          sha256: hash,
          chunkSize,
          totalChunks: Math.ceil(stats.size / chunkSize),
          lastModified: stats.mtime.toISOString(),
        });
      }

      // Send handshake
      const request: HandshakeRequest = {
        type: 'handshake-request',
        version: PROTOCOL_VERSION,
        sender: deviceIdentity,
        files,
        sessionPublicKey: '',
        timestamp: new Date().toISOString(),
      };

      const response = await client.sendHandshake(request);

      if (!response.accepted) {
        return { error: 'Transfer rejected' };
      }

      // Send each file
      for (let i = 0; i < files.length; i++) {
        const metadata = files[i];
        const filePath = filePaths[i];

        await client.sendFile(filePath, metadata, (bytesSent, totalBytes) => {
          mainWindow?.webContents.send('send-progress', {
            fileId: metadata.fileId,
            bytesSent,
            totalBytes,
            fileName: metadata.fileName,
          });
        });
      }

      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Transfer failed' };
    }
  });

  // Select save directory
  ipcMain.handle('select-save-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select save location',
    });
    return result.filePaths[0] ?? null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupIPC();
  await startServices();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  lanServer?.stop();
  mdnsDiscovery?.destroy();
});
