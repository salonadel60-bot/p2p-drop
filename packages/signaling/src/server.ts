import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { dirname, extname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HEARTBEAT_INTERVAL = 30_000;
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  capabilities: string[];
  publicKeyFingerprint?: string;
}

interface SignalEnvelope {
  action: 'announce' | 'leave' | 'signal' | 'ping' | 'pong';
  senderId: string;
  clientId?: string;
  senderDevice?: DeviceInfo;
  targetId?: string;
  room?: string;
  payload?: unknown;
  timestamp: number;
}

interface ConnectedPeer {
  ws: WebSocket;
  deviceId: string;
  device?: DeviceInfo;
  clientId?: string;
  room: string;
  lastPing: number;
  alive: boolean;
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

class SignalingServer {
  private wss: WebSocketServer;
  private httpServer: http.Server;
  private peers = new Map<string, ConnectedPeer>();
  private rooms = new Map<string, Set<string>>();
  private heartbeatTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
  }

  start(): void {
    this.httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[P2P Drop] Server listening on port ${PORT}`);
      console.log(`[P2P Drop] WebSocket signaling path: /signaling`);
      console.log(`[P2P Drop] Static web directory: ${PUBLIC_DIR}`);
    });
  }

  stop(): void {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
    this.httpServer.close();
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      this.sendJson(res, { status: 'ok', peers: this.peers.size, rooms: this.rooms.size, uptime: process.uptime() });
      return;
    }

    if (url.pathname === '/stats') {
      const rooms = Array.from(this.rooms.entries()).map(([room, members]) => ({ room, members: members.size }));
      this.sendJson(res, { rooms, totalPeers: this.peers.size });
      return;
    }

    if (url.pathname === '/signaling') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('P2P Drop signaling endpoint');
      return;
    }

    this.serveStatic(url.pathname, res);
  }

  private sendJson(res: http.ServerResponse, body: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    if (!existsSync(PUBLIC_DIR)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('P2P Drop Signaling Server');
      return;
    }

    const safePath = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^\/+/, '');
    let filePath = resolve(join(PUBLIC_DIR, safePath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html');
    }

    if (!existsSync(filePath)) {
      filePath = join(PUBLIC_DIR, 'index.html');
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
    const room = url.searchParams.get('room') || 'public';
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const peer: ConnectedPeer = { ws, deviceId: tempId, room, lastPing: Date.now(), alive: true };

    this.peers.set(tempId, peer);
    this.addToRoom(room, tempId);
    console.log(`[P2P Drop] Peer connected: ${tempId} -> room: ${room}`);

    ws.on('message', (data) => {
      try {
        this.handleMessage(peer, JSON.parse(data.toString()) as SignalEnvelope);
      } catch {
        this.sendToPeer(peer, { action: 'pong', senderId: 'server', timestamp: Date.now() });
      }
    });

    ws.on('close', () => this.handleDisconnect(peer));
    ws.on('pong', () => { peer.alive = true; });
  }

  private handleMessage(peer: ConnectedPeer, envelope: SignalEnvelope): void {
    peer.lastPing = Date.now();
    peer.alive = true;
    peer.clientId = envelope.clientId ?? peer.clientId;

    switch (envelope.action) {
      case 'announce': {
        const oldId = peer.deviceId;
        const existing = envelope.senderId ? this.peers.get(envelope.senderId) : null;
        if (existing && existing !== peer) {
          existing.ws.terminate();
          this.removeFromRoom(existing.room, existing.deviceId);
        }

        if (envelope.senderId && envelope.senderId !== oldId) {
          this.peers.delete(oldId);
          this.removeFromRoom(peer.room, oldId);
          peer.deviceId = envelope.senderId;
          this.peers.set(envelope.senderId, peer);
          this.addToRoom(peer.room, envelope.senderId);
        }

        if (envelope.senderDevice) {
          peer.device = envelope.senderDevice;
        }

        this.broadcastToRoom(peer.room, envelope, peer.deviceId);
        this.sendExistingPeers(peer);
        break;
      }

      case 'signal': {
        if (envelope.targetId) {
          const target = this.peers.get(envelope.targetId);
          if (target) this.sendToPeer(target, envelope);
        }
        break;
      }

      case 'leave':
        this.handleDisconnect(peer);
        break;

      case 'ping':
        this.sendToPeer(peer, { action: 'pong', senderId: 'server', timestamp: Date.now() });
        break;
    }
  }

  private sendExistingPeers(peer: ConnectedPeer): void {
    const roomPeers = this.rooms.get(peer.room);
    if (!roomPeers) return;

    for (const memberId of roomPeers) {
      if (memberId === peer.deviceId) continue;
      const member = this.peers.get(memberId);
      if (member?.device && member.clientId && member.clientId !== peer.clientId) {
        this.sendToPeer(peer, {
          action: 'announce',
          senderId: member.deviceId,
          clientId: member.clientId,
          senderDevice: member.device,
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleDisconnect(peer: ConnectedPeer): void {
    if (this.peers.get(peer.deviceId) !== peer) return;

    this.broadcastToRoom(peer.room, { action: 'leave', senderId: peer.deviceId, clientId: peer.clientId, timestamp: Date.now() }, peer.deviceId);
    this.peers.delete(peer.deviceId);
    this.removeFromRoom(peer.room, peer.deviceId);
    console.log(`[P2P Drop] Peer disconnected: ${peer.deviceId}`);
  }

  private broadcastToRoom(room: string, message: SignalEnvelope, excludeId?: string): void {
    const members = this.rooms.get(room);
    if (!members) return;

    const data = JSON.stringify(message);
    for (const memberId of members) {
      if (memberId === excludeId) continue;
      const member = this.peers.get(memberId);
      if (message.clientId && (!member?.clientId || member.clientId === message.clientId)) continue;
      if (member?.ws.readyState === WebSocket.OPEN) member.ws.send(data);
    }
  }

  private sendToPeer(peer: ConnectedPeer, message: SignalEnvelope): void {
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify(message));
  }

  private addToRoom(room: string, peerId: string): void {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(peerId);
  }

  private removeFromRoom(room: string, peerId: string): void {
    const members = this.rooms.get(room);
    if (!members) return;
    members.delete(peerId);
    if (members.size === 0) this.rooms.delete(room);
  }

  private heartbeat(): void {
    for (const [id, peer] of this.peers) {
      if (!peer.alive) {
        console.log(`[P2P Drop] Removing dead peer: ${id}`);
        peer.ws.terminate();
        this.handleDisconnect(peer);
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
  }
}

const server = new SignalingServer();
server.start();

process.on('SIGINT', () => {
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});
