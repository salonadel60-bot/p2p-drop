/**
 * Lightweight WebSocket Signaling Server for P2P Drop.
 * 
 * This server facilitates WebRTC peer discovery and connection establishment
 * across different networks. It does NOT relay file data — only signaling
 * messages (offers, answers, ICE candidates).
 * 
 * Features:
 * - Room-based peer grouping
 * - Automatic peer announcement
 * - Heartbeat / keepalive
 * - Configurable via environment variables
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HEARTBEAT_INTERVAL = 30_000;

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  capabilities: string[];
}

interface SignalEnvelope {
  action: 'announce' | 'leave' | 'signal' | 'ping' | 'pong';
  senderId: string;
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
  room: string;
  lastPing: number;
  alive: boolean;
}

class SignalingServer {
  private wss: WebSocketServer;
  private httpServer: http.Server;
  private peers = new Map<string, ConnectedPeer>();
  private rooms = new Map<string, Set<string>>();
  private heartbeatTimer: ReturnType<typeof setInterval>;

  constructor() {
    // HTTP server for health checks
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          peers: this.peers.size,
          rooms: this.rooms.size,
          uptime: process.uptime(),
        }));
      } else if (req.url === '/stats') {
        const roomStats = Array.from(this.rooms.entries()).map(([name, members]) => ({
          room: name,
          members: members.size,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rooms: roomStats, totalPeers: this.peers.size }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('P2P Drop Signaling Server');
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    // Heartbeat to detect dead connections
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
  }

  start(): void {
    this.httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[Signaling] Server listening on port ${PORT}`);
      console.log(`[Signaling] Health: http://localhost:${PORT}/health`);
    });
  }

  stop(): void {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
    this.httpServer.close();
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Extract room from URL query (e.g., ws://server:8080?room=abc)
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const room = url.searchParams.get('room') || 'default';

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const peer: ConnectedPeer = {
      ws,
      deviceId: tempId,
      room,
      lastPing: Date.now(),
      alive: true,
    };

    this.peers.set(tempId, peer);
    this.addToRoom(room, tempId);

    console.log(`[Signaling] Peer connected: ${tempId} -> room: ${room}`);

    ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString()) as SignalEnvelope;
        this.handleMessage(peer, envelope);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(peer);
    });

    ws.on('pong', () => {
      peer.alive = true;
    });
  }

  private handleMessage(peer: ConnectedPeer, envelope: SignalEnvelope): void {
    peer.lastPing = Date.now();
    peer.alive = true;

    switch (envelope.action) {
      case 'announce': {
        // Update peer identity
        const oldId = peer.deviceId;
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

        // Broadcast to room
        this.broadcastToRoom(peer.room, envelope, peer.deviceId);

        // Send existing peers to the new peer
        const roomPeers = this.rooms.get(peer.room);
        if (roomPeers) {
          for (const memberId of roomPeers) {
            if (memberId === peer.deviceId) continue;
            const member = this.peers.get(memberId);
            if (member?.device) {
              const announce: SignalEnvelope = {
                action: 'announce',
                senderId: member.deviceId,
                senderDevice: member.device,
                timestamp: Date.now(),
              };
              this.sendToPeer(peer, announce);
            }
          }
        }
        break;
      }

      case 'signal': {
        // Forward signaling message to target
        if (envelope.targetId) {
          const target = this.peers.get(envelope.targetId);
          if (target) {
            this.sendToPeer(target, envelope);
          }
        }
        break;
      }

      case 'leave': {
        this.handleDisconnect(peer);
        break;
      }

      case 'ping': {
        const pong: SignalEnvelope = {
          action: 'pong',
          senderId: 'server',
          timestamp: Date.now(),
        };
        this.sendToPeer(peer, pong);
        break;
      }
    }
  }

  private handleDisconnect(peer: ConnectedPeer): void {
    const leaveMsg: SignalEnvelope = {
      action: 'leave',
      senderId: peer.deviceId,
      timestamp: Date.now(),
    };
    this.broadcastToRoom(peer.room, leaveMsg, peer.deviceId);

    this.peers.delete(peer.deviceId);
    this.removeFromRoom(peer.room, peer.deviceId);

    console.log(`[Signaling] Peer disconnected: ${peer.deviceId}`);
  }

  private broadcastToRoom(room: string, message: SignalEnvelope, excludeId?: string): void {
    const members = this.rooms.get(room);
    if (!members) return;

    const data = JSON.stringify(message);
    for (const memberId of members) {
      if (memberId === excludeId) continue;
      const member = this.peers.get(memberId);
      if (member?.ws.readyState === WebSocket.OPEN) {
        member.ws.send(data);
      }
    }
  }

  private sendToPeer(peer: ConnectedPeer, message: SignalEnvelope): void {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(message));
    }
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
    if (members) {
      members.delete(peerId);
      if (members.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  private heartbeat(): void {
    for (const [id, peer] of this.peers) {
      if (!peer.alive) {
        console.log(`[Signaling] Removing dead peer: ${id}`);
        peer.ws.terminate();
        this.handleDisconnect(peer);
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
  }
}

// Start the server
const server = new SignalingServer();
server.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Signaling] Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});
