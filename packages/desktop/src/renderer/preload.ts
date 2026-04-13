/**
 * Preload script for Electron renderer.
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Identity
  getIdentity: () => ipcRenderer.invoke('get-identity'),

  // Peers
  getPeers: () => ipcRenderer.invoke('get-peers'),
  onPeerDiscovered: (callback: (peer: unknown) => void) => {
    ipcRenderer.on('peer-discovered', (_event, peer) => callback(peer));
  },
  onPeerLost: (callback: (deviceId: string) => void) => {
    ipcRenderer.on('peer-lost', (_event, deviceId) => callback(deviceId));
  },
  onPeerConnected: (callback: (peer: unknown) => void) => {
    ipcRenderer.on('peer-connected', (_event, peer) => callback(peer));
  },

  // File operations
  selectFiles: () => ipcRenderer.invoke('select-files'),
  sendFiles: (peerAddress: string, peerPort: number, filePaths: string[]) =>
    ipcRenderer.invoke('send-files', peerAddress, peerPort, filePaths),
  selectSaveDir: () => ipcRenderer.invoke('select-save-dir'),

  // Transfer events
  onTransferRequest: (callback: (request: unknown) => void) => {
    ipcRenderer.on('transfer-request', (_event, request) => callback(request));
  },
  respondToTransfer: (accepted: boolean) => {
    ipcRenderer.send('transfer-response', accepted);
  },
  onTransferProgress: (callback: (data: unknown) => void) => {
    ipcRenderer.on('transfer-progress', (_event, data) => callback(data));
  },
  onSendProgress: (callback: (data: unknown) => void) => {
    ipcRenderer.on('send-progress', (_event, data) => callback(data));
  },
  onTransferComplete: (callback: (data: unknown) => void) => {
    ipcRenderer.on('transfer-complete', (_event, data) => callback(data));
  },
  onTransferError: (callback: (data: unknown) => void) => {
    ipcRenderer.on('transfer-error', (_event, data) => callback(data));
  },

  // Identity event
  onIdentity: (callback: (identity: unknown) => void) => {
    ipcRenderer.on('identity', (_event, identity) => callback(identity));
  },
};

contextBridge.exposeInMainWorld('p2pDrop', api);
