# vid-chat — Real-time video conferencing powered by a WebRTC SFU

A full-stack browser-based video meeting app where every participant's media is routed through a **Selective Forwarding Unit (SFU)** instead of a fragile peer-to-peer mesh, making it scale gracefully to many participants.

---

## Demo / Architecture

```
Browser A                   Node.js Server                 Browser B
─────────                   ──────────────                 ─────────
getUserMedia()              Express + Socket.IO            getUserMedia()
    │                            │                              │
    ├──── sfu:join ─────────────►│◄──────── sfu:join ──────────┤
    │◄─── rtpCapabilities ───────┤──────── rtpCapabilities ────►│
    │                            │                              │
    ├──── sfu:createTransport ──►│◄─── sfu:createTransport ─────┤
    │◄─── DTLS/ICE params ───────┤──── DTLS/ICE params ────────►│
    │                            │                              │
    ├──── sfu:produce (audio) ──►│                              │
    ├──── sfu:produce (video) ──►│──── sfu:newProducer ────────►│
    │                            │                              │
    │                            │◄─── sfu:consume ─────────────┤
    │                            │──── RTP params ─────────────►│
    │◄══════════ media (VP8 + Opus) ══════════════════════════►│
    │                            │                              │
    │◄──── chat:message ─────────┤──── chat:message ───────────►│
```

---

## Why I Built This

Standard peer-to-peer WebRTC (mesh topology) breaks down quickly: each new participant adds _N_ additional upload streams to every existing peer. An SFU solves this by having each client upload **once** to the server, which then forwards selectively to every other subscriber. This project was built to learn how mediasoup implements that model end-to-end — from WebRTC transport negotiation and DTLS/ICE, all the way up to a React UI with real-time chat.

---

## Key Technical Highlights

- **SFU architecture via mediasoup** — a single mediasoup worker/router handles all rooms; each peer gets its own send + receive WebRTC transport pair, and tracks are forwarded server-side with no re-encoding.
- **Full mediasoup signaling flow** — `sfu:join` → `sfu:createTransport` → `sfu:connectTransport` → `sfu:produce` → `sfu:consume` → `sfu:resume`, implemented cleanly over Socket.IO acknowledgements.
- **STUN + self-hosted TURN** — ICE candidates include both Google STUN and a self-hosted TURN server so the app works across NAT/firewall-restricted networks.
- **Graceful teardown** — clicking Leave or closing the tab closes all consumers, producers, and transports both client-side and server-side, preventing resource leaks in the mediasoup worker.
- **Real-time in-room chat** — Socket.IO room-scoped chat with server-side history (last 50 messages) replayed to new joiners, with input validation and length caps.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 19 + Vite |
| Routing | React Router v7 |
| WebRTC media (client) | mediasoup-client 3 |
| Signaling | Socket.IO 4 |
| Styling | Tailwind CSS + styled-components |
| Icons | Lucide React |
| Auth (optional) | Supabase |
| Server runtime | Node.js 18+ |
| HTTP server | Express 5 |
| SFU engine | mediasoup 3 |
| Codecs | VP8 (video) · Opus (audio) |

---

## How to Run Locally

### Prerequisites

- Node.js 18 or later
- Chrome or Edge (required for WebRTC `getUserMedia`)
- Camera and microphone

### 1. Configure the server

Create `server/.env`:

```env
PORT=5000
CLIENT_ORIGINS=http://localhost:5173

MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1   # use your LAN/public IP for multi-device testing

RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
```

### 2. Configure the client

Create `client/.env.local`:

```env
VITE_SIGNALING_URL=http://localhost:5000
VITE_SUPABASE_URL=YOUR_SUPABASE_URL       # only needed if using the login page
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

### 3. Start the server

```bash
cd server
npm install
node index.js
# → Server running on port 5000
# Health check: http://localhost:5000/health
```

### 4. Start the client

```bash
cd client
npm install
npm run dev
# → http://localhost:5173
```

### 5. Test a meeting

1. Open `http://localhost:5173` and click **New Meeting**.
2. Open the same room URL in a second tab or incognito window.
3. Allow camera/microphone — you should see remote video tiles appear and hear audio.

---

## Architecture Overview

```
client/
  src/
    pages/
      Home.jsx          # Landing page — create or join a room
      Room.jsx          # Core meeting room: SFU join/produce/consume + chat UI
    components/
      VideoTile.jsx     # Renders a MediaStream into a <video> element
      AudioTile.jsx     # Renders remote audio into an <audio> element (separate from video to avoid echo)
      PrivateRoute.jsx  # Auth guard for protected routes
    supabase.js         # Supabase client initialisation

server/
  index.js             # Socket.IO signaling server + chat logic
  mediasoup.js         # mediasoup worker / router / transport / peer lifecycle
```

**Media flow summary:**

1. Client emits `sfu:join` → server returns router RTP capabilities.
2. Client creates a `Device`, then requests two WebRTC transports (send + recv).
3. DTLS parameters are exchanged via `sfu:connectTransport`.
4. Client calls `getUserMedia` and produces audio + video tracks via `sfu:produce`.
5. Server broadcasts `sfu:newProducer` to other peers in the room.
6. Other clients call `sfu:consume` to receive a paused consumer, then `sfu:resume` to start the media flow.

---

## Known Limitations / What I'd Improve

- **In-memory state** — rooms, peers, and chat history live only in the Node process; a server restart clears everything. A Redis store would fix this.
- **Anonymous peers** — participants are identified only by their Socket.IO ID. Adding a proper identity/display-name system (backed by Supabase) would improve UX.
- **No simulcast / SVC** — the SFU forwards a single quality layer. Adding simulcast would allow adaptive bitrate for viewers on poor connections.
- **No host controls** — anyone with the room link can join; there is no waiting room, knock-to-join, or mute-all.
- **No screen sharing** — the producer track could be replaced with a `getDisplayMedia` track, but this is not yet implemented.
- **No recording** — one of the main advantages of an SFU is server-side recording; this is a natural next step.
