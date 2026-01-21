# Video Chat v2 (SFU) — Current Stable Stage

This repo contains a **WebRTC video meeting app** built with:
- **Client:** React + Vite
- **Signaling:** Socket.IO
- **SFU:** mediasoup (server relays media streams; not mesh)

At this stage the **core infrastructure is stable**:
- Join a room and publish **audio + video** via mediasoup
- Consume other participants’ **audio + video**
- In-room **chat** (temporary in-memory history)
- Clean up producers/consumers/transports on leave/disconnect

---

## Project Structure

```
video-chat-v2/
  client/        # React UI (Vite)
  server/        # Express + Socket.IO + mediasoup SFU
  README.md
```

### Client (`/client`)
Key files:
- `src/pages/Home.jsx` — landing page (create/join room)
- `src/pages/Room.jsx` — meeting room: mediasoup join/produce/consume + chat
- `src/components/VideoTile.jsx` — video rendering (MediaStream -> <video>)
- `src/components/AudioTile.jsx` — remote audio playback (MediaStream -> <audio>)

### Server (`/server`)
Key files:
- `index.js` — Socket.IO signaling + chat + mediasoup events
- `mediasoup.js` — creates mediasoup worker/router/transports and manages rooms/peers

---

## How Media Works (SFU)

High-level flow:
1. Client connects to Socket.IO (`VITE_SIGNALING_URL`)
2. Client joins SFU room: `sfu:join` → receives router RTP capabilities
3. Client creates 2 transports:
   - `sfu:createTransport` (send)
   - `sfu:createTransport` (recv)
4. Client connects transports via DTLS:
   - `sfu:connectTransport`
5. Client captures local media:
   - `getUserMedia({ audio: true, video: true })`
6. Client produces tracks:
   - `sfu:produce` for audio + video
7. Client discovers remote producers:
   - fetch existing via `sfu:getProducers`
   - listen for `sfu:newProducer`
8. Client consumes:
   - `sfu:consume` → creates consumer (paused)
   - `sfu:resume` → starts media flow
9. Rendering:
   - local preview uses `<VideoTile stream={userStream} muted />`
   - remote audio uses `<AudioTile stream={remoteStream} />`
   - remote video uses `<VideoTile stream={remoteStream} muted />`

---

## Prerequisites

- Node.js 18+ recommended
- Chrome / Edge for testing
- On Windows, allow camera/microphone permissions in browser

---

## Environment Variables

### Server (`/server/.env`)
Create `server/.env`:

```env
PORT=5000
CLIENT_ORIGINS=http://localhost:5173

MEDIASOUP_LISTEN_IP=0.0.0.0
# IMPORTANT:
# - For same-machine local testing you may set:
#   MEDIASOUP_ANNOUNCED_IP=127.0.0.1
# - For LAN/deploy set it to your machine's LAN/public IP.
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
```

### Client (`/client/.env.local`)
Create `client/.env.local`:

```env
VITE_SIGNALING_URL=http://localhost:5000
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Notes:
- Supabase variables are required only for the login route/components; the meeting room itself uses Socket.IO + mediasoup.

---

## Install & Run (Local)

### 1) Start server
```bat
cd d:\codes\video-chat-v2\server
npm install
node index.js
```

Server should print:
- `Server running on port 5000`

Health check:
- http://localhost:5000/health

### 2) Start client
```bat
cd d:\codes\video-chat-v2\client
npm install
npm run dev
```

Open:
- http://localhost:5173

### 3) Test meeting
- Create a new meeting from Home
- Open another tab/incognito and join the same room id
- You should see remote tiles appear and audio play

---

## Deployment Notes (Important)

### HTTPS is required
Browsers require a secure context for camera/mic in production:
- Frontend must be **https**
- Signaling should be served over **https/wss** (often via reverse proxy)

### mediasoup IP + ports
For real deployment / multi-device usage:
- Set `MEDIASOUP_ANNOUNCED_IP` to the server **public IP** (or correct NAT public address).
- Open UDP ports `RTC_MIN_PORT..RTC_MAX_PORT` on the firewall/security group.
- If running behind NAT, correct announced IP is mandatory.

---

## Cleanup / Lifecycle Behavior

- Clicking **Leave**:
  - Calls `sfu:leave` (best effort)
  - Closes consumers + producers + transports
  - Stops local getUserMedia tracks
  - Disconnects socket
- On socket `disconnect`:
  - Server removes user from chat room (legacy room list)
  - Server calls mediasoup cleanup across rooms to close peer resources

---

## Known Limitations (Current Stage)

- Rooms and chat history are **in-memory** (lost on server restart).
- No identity/roles yet (peers shown by socket id).
- No TURN server configuration yet (may fail on restrictive networks without TURN).
- No host controls, waiting room, screen share, recording (planned).

---

## Next Planned Features (Roadmap)

Recommended next improvements:
1. Host + waiting room (knock to join)
2. Screen sharing (produce/replace track)
3. Active speaker detection (audio level analysis)
4. Connection quality & stats overlay
5. Recording (SFU advantage)

---

## Troubleshooting

### “Video doesn’t show / audio silent”
- Check browser console for:
  - `[sendTransport] connectionstatechange: connected`
  - `[recvTransport] connectionstatechange: connected`
- Ensure `MEDIASOUP_ANNOUNCED_IP` is correct for your testing scenario:
  - same machine: `127.0.0.1` often works
  - other devices / deploy: must be LAN/public IP

### “Audio autoplay blocked”
Some browsers block autoplay audio until you interact with the page.
- Click once on the page after joining.

---

## License
ISC (current package.json). Adjust as needed.