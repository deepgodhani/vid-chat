# vid-chat server — Express + Socket.IO + mediasoup SFU signaling backend

The server-side half of vid-chat: a Node.js process that acts as the **Selective Forwarding Unit (SFU)** signaling hub, managing WebRTC transport negotiation and forwarding media tracks between browser peers via mediasoup.

---

## Architecture Diagram

```
                        ┌────────────────────────────────────┐
                        │          Node.js Process           │
                        │                                    │
  Browser A ──WS/WSS──► │  Socket.IO server                  │ ◄──WS/WSS── Browser B
                        │      │                             │
                        │      ▼                             │
                        │  signaling events                  │
                        │  (sfu:join, sfu:produce, ...)      │
                        │      │                             │
                        │      ▼                             │
                        │  mediasoup Worker                  │
                        │    └─ Router (per room)            │
                        │         ├─ WebRtcTransport (send A)│
                        │         ├─ WebRtcTransport (recv A)│
                        │         ├─ WebRtcTransport (send B)│
                        │         └─ WebRtcTransport (recv B)│
                        │                                    │
                        │  RTP/RTCP forwarded by mediasoup   │
  Browser A ◄═══UDP════►│══════════════════════════════════►│═══UDP═══► Browser B
                        └────────────────────────────────────┘
```

---

## Why I Built This

A mesh WebRTC architecture requires every participant to open a direct connection to every other participant, which explodes upload bandwidth as the room grows. This server acts as an SFU: each browser uploads its tracks **once** to the server, and mediasoup forwards them selectively to other subscribers — no re-encoding, just RTP packet routing.

---

## Key Technical Highlights

- **Single mediasoup worker, multiple routers** — one worker process is shared across all rooms; each room gets its own router with VP8 + Opus codecs configured.
- **Per-peer resource tracking** — each socket ID maps to a `peer` object (`transports`, `producers`, `consumers` Maps) stored in a room's `peers` Map, making cleanup precise and leak-free.
- **DTLS/ICE via `createWebRtcTransport`** — transports are created with configurable `listenIps`/`announcedIp` from `.env`, supporting both local testing (`127.0.0.1`) and public deployments.
- **Automatic peer cleanup** — both `sfu:leave` (explicit) and socket `disconnect` (implicit) trigger `cleanupPeer()`, which closes all consumers, producers, and transports and removes the room when empty.
- **Room-scoped chat with replay** — Socket.IO room events carry chat messages; a server-side ring buffer (max 50 messages) replays history to new joiners via `chat:history`.

---

## Tech Stack

| Concern | Library |
|---------|---------|
| HTTP server | Express 5 |
| WebSocket / signaling | Socket.IO 4 |
| SFU / WebRTC media | mediasoup 3 |
| Environment config | dotenv |
| Video codec | VP8 |
| Audio codec | Opus (48 kHz, stereo) |
| Runtime | Node.js 18+ |

---

## How to Run Locally

### Prerequisites

- Node.js 18 or later
- On Linux/macOS: build tools for mediasoup native modules (`build-essential`, `python3`, `clang`)
- On Windows: Visual Studio Build Tools

### 1. Install dependencies

```bash
cd server
npm install
```

> mediasoup compiles a native C++ addon during `npm install`. This can take a minute.

### 2. Create `.env`

```env
PORT=5000
CLIENT_ORIGINS=http://localhost:5173

# IP that mediasoup binds to (use 0.0.0.0 to listen on all interfaces)
MEDIASOUP_LISTEN_IP=0.0.0.0

# IP announced to remote peers in ICE candidates.
# - Local testing:  127.0.0.1
# - LAN testing:    your machine's LAN IP (e.g. 192.168.1.10)
# - Public server:  your server's public IP
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

# UDP port range for RTP/RTCP — open these on any firewall / security group
RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
```

### 3. Start the server

```bash
node index.js
# → Server running on port 5000
```

Health check:

```
GET http://localhost:5000/health
→ { "ok": true }
```

---

## Architecture Overview

```
server/
├── index.js        # Entry point
│   ├── Express app + HTTP server
│   ├── Socket.IO server (CORS-gated by CLIENT_ORIGINS)
│   ├── Legacy room tracking (users / socketToRoom) — used for chat
│   ├── Chat: chat:send → pushRoomMessage → broadcast chat:message
│   └── SFU signaling events:
│       ├── sfu:join             → getOrCreateRoom, getPeer
│       ├── sfu:leave            → cleanupPeer
│       ├── sfu:createTransport  → createWebRtcTransport, peer.transports.set
│       ├── sfu:connectTransport → transport.connect(dtlsParameters)
│       ├── sfu:produce          → transport.produce → notify sfu:newProducer
│       ├── sfu:getProducers     → list all remote producers in room
│       ├── sfu:consume          → router.consume (paused)
│       ├── sfu:resume           → consumer.resume
│       └── disconnect           → cleanupPeer across all rooms
│
└── mediasoup.js    # mediasoup abstractions
    ├── getWorker()            — singleton mediasoup.Worker
    ├── getOrCreateRoom()      — Worker.createRouter + rooms Map
    ├── getPeer()              — lazy-create peer in room.peers
    ├── cleanupPeer()          — close consumers/producers/transports, delete peer/room
    └── createWebRtcTransport() — transport with ICE/DTLS/RTCP config from .env
```

**Signaling sequence (one peer joining):**

```
Client                          Server (Socket.IO)
──────                          ──────────────────
sfu:join {roomId}          →    getOrCreateRoom → cb(rtpCapabilities)
sfu:createTransport {send} →    createWebRtcTransport → cb(id, iceParams, dtlsParams)
sfu:createTransport {recv} →    createWebRtcTransport → cb(id, iceParams, dtlsParams)
sfu:connectTransport       →    transport.connect(dtlsParameters) → cb(ok)
sfu:produce {audio}        →    transport.produce → emit sfu:newProducer to room
sfu:produce {video}        →    transport.produce → emit sfu:newProducer to room
sfu:getProducers           →    list existing producers → cb(producers[])
sfu:consume {producerId}   →    transport.consume (paused) → cb(consumerParams)
sfu:resume {consumerId}    →    consumer.resume() → cb(ok)
```

---

## Known Limitations / What I'd Improve

- **In-memory rooms** — all room/peer state lives in Maps inside the Node process. A Redis or database-backed store would survive restarts and support horizontal scaling.
- **Single worker** — one mediasoup worker uses one CPU core. For higher load, a worker pool (one per CPU) with a load-balancing router-selection strategy is the standard approach.
- **No TURN server bundled** — the server itself only does signaling; ICE traversal for restrictive networks requires a separate TURN server (e.g., coturn). The client hardcodes a TURN URL that must be replaced for your own deployment.
- **No authentication on SFU events** — any socket can join any room. Adding JWT verification on `sfu:join` would lock rooms to authenticated users.
- **No simulcast / bandwidth estimation** — mediasoup supports simulcast and REMB/TWCC, but they are not configured here; all clients receive the same single-quality stream.
