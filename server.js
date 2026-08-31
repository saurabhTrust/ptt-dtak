/**
 * server.js — Standalone signaling/presence relay for the walkie-talkie PTT app.
 * -----------------------------------------------------------------------------
 * The app uses Gun as its signaling + presence bus (offers/answers/ICE, member
 * list, PTT "who's talking" flag). This process IS that bus. Run it, then point
 * the client at it:
 *
 *   const wt = createWalkieTalkie({ gunPeers: ['http://YOUR_HOST:8765/gun'] });
 *
 * It does NOT relay audio — audio is peer-to-peer WebRTC (STUN/TURN handles NAT).
 * See the note at the bottom about self-hosting TURN.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   npm install
 *   npm start                       # listens on :8765
 *
 * ── Config (environment variables) ───────────────────────────────────────────
 *   PORT         Port to listen on.               Default 8765
 *   HOST         Bind address.                     Default 0.0.0.0
 *   DATA_DIR     Gun on-disk storage folder.       Default ./radata
 *   PERSIST      'false' → ephemeral (no disk).    Default true
 *   PUBLIC_DIR   Folder of static files to serve   Default ./public (if exists)
 *                (drop your index.html here to serve the client from this server)
 * -----------------------------------------------------------------------------
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const Gun = require('gun');

const PORT       = parseInt(process.env.PORT, 10) || 8765;
const HOST       = process.env.HOST || '0.0.0.0';
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'radata');
const PERSIST    = process.env.PERSIST !== 'false';
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

const app = express();

// Health check (handy for load balancers / uptime monitors / Docker HEALTHCHECK)
let peerCount = 0;
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), peers: peerCount, ts: Date.now() });
});

// Gun's express middleware: serves gun.js and wires the HTTP side of the relay.
app.use(Gun.serve);

// Optionally serve the client app (index.html, walkie-talkie-*.js) from PUBLIC_DIR.
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  console.log('[relay] serving static files from', PUBLIC_DIR);
}

const server = app.listen(PORT, HOST, () => {
  console.log('──────────────────────────────────────────────');
  console.log('  Walkie-Talkie signaling relay is up');
  console.log('  Gun endpoint : http://' + HOST + ':' + PORT + '/gun');
  console.log('  Health       : http://' + HOST + ':' + PORT + '/health');
  console.log('  Persistence  : ' + (PERSIST ? DATA_DIR : 'OFF (ephemeral)'));
  console.log('──────────────────────────────────────────────');
  console.log('  Point the client at:  gunPeers: ["http://<this-host>:' + PORT + '/gun"]');
});

// Attach Gun to the same HTTP server (shares the port; upgrades to WebSocket).
const gunOptions = { web: server };
if (PERSIST) { gunOptions.radisk = true; gunOptions.file = DATA_DIR; }
else         { gunOptions.radisk = false; gunOptions.localStorage = false; }

const gun = Gun(gunOptions);

// Lightweight peer connect/disconnect logging (mesh events; version-tolerant).
try {
  gun.on('hi',  () => { peerCount++; console.log('[relay] peer connected    → total', peerCount); });
  gun.on('bye', () => { peerCount = Math.max(0, peerCount - 1); console.log('[relay] peer disconnected → total', peerCount); });
} catch (e) { /* mesh events optional across Gun versions */ }

// Graceful shutdown
function shutdown(sig) {
  console.log('\n[relay] ' + sig + ' received, shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ─────────────────────────────────────────────────────────────────────────────
 * NOTE ON TURN (media relay) — separate from this server.
 *
 * This relay only carries signaling + presence. The actual voice is peer-to-peer.
 * When two peers are behind strict NATs/firewalls, WebRTC needs a TURN server to
 * relay the media. Your client currently uses metered.ca's TURN. To self-host,
 * run coturn on a public host, e.g. /etc/turnserver.conf:
 *
 *     listening-port=3478
 *     tls-listening-port=5349
 *     fingerprint
 *     lt-cred-mech
 *     user=ptt:strongpassword
 *     realm=yourdomain.com
 *     external-ip=YOUR_PUBLIC_IP
 *
 * Then pass matching iceServers to the client:
 *     createWalkieTalkie({
 *       gunPeers: ['http://YOUR_HOST:8765/gun'],
 *       rtcConfig: { iceServers: [
 *         { urls: 'stun:yourdomain.com:3478' },
 *         { urls: 'turn:yourdomain.com:3478', username: 'ptt', credential: 'strongpassword' }
 *       ] }
 *     });
 * ───────────────────────────────────────────────────────────────────────────── */