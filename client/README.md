# vid-chat client — React + Vite frontend for a mediasoup SFU video meeting

The browser-side half of vid-chat: handles camera/microphone capture, WebRTC transport negotiation with a mediasoup SFU, real-time chat, and a responsive multi-tile video grid.

---

## Demo / Screenshot

```
┌─────────────────────────────────────────────────────────────┐
│  Video Chat Pro                                             │
├────────────────────────┬────────────────────────────────────┤
│                        │                                    │
│   ┌──────────────┐     │   ┌──────────────┐                │
│   │     You      │     │   │  Peer a1b2c3 │                │
│   │  (local cam) │     │   │ (remote cam) │                │
│   └──────────────┘     │   └──────────────┘                │
│                        │                                    │
├────────────────────────┴────────────────────────────────────┤
│  Chat                                              [ Hide ] │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  a1b2c3: Hello!                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  [ Type a message…                          ] [ Send ]      │
├─────────────────────────────────────────────────────────────┤
│               [ 🎤 Mute ]    [ 📷 Stop Video ]              │
└─────────────────────────────────────────────────────────────┘
```

---

## Why I Built This

Most WebRTC tutorials stop at a two-peer mesh demo. This client was built to wire up the full **mediasoup-client** lifecycle — device loading, dual transports, produce/consume — so the UI could act as a drop-in participant in a real SFU room with many peers.

---

## Key Technical Highlights

- **mediasoup-client device lifecycle** — loads router RTP capabilities, negotiates DTLS/ICE for separate send and receive transports, and calls produce/consume/resume in the right order.
- **Dual-transport model** — one `SendTransport` for publishing local tracks and one `RecvTransport` for subscribing to remote producers, keeping send and receive paths independent.
- **Separate `<AudioTile>` + `<VideoTile>` components** — remote audio and video are rendered in different DOM elements, so audio plays without the `muted` restriction that browser autoplay policies impose on `<video>`.
- **Race-free join guard** — a `joiningRef` ref prevents the async join flow from running twice if the user clicks Join rapidly, avoiding duplicate socket connections and transport pairs.
- **Friendly media error messages** — `NotAllowedError`, `NotReadableError`, and `NotFoundError` from `getUserMedia` are translated into plain-English UI feedback.

---

## Tech Stack

| Concern | Library / Tool |
|---------|---------------|
| UI framework | React 19 |
| Build tool | Vite 7 |
| Routing | React Router v7 |
| WebRTC SFU client | mediasoup-client 3 |
| Signaling transport | socket.io-client 4 |
| Styling | Tailwind CSS (utility classes) + styled-components |
| Icons | Lucide React |
| Auth | @supabase/supabase-js 2 |
| Unique IDs | uuid |
| Polyfills | vite-plugin-node-polyfills (for `process`, `Buffer` in browser) |

---

## How to Run Locally

### Prerequisites

- Node.js 18+
- The [server](../server) running on `http://localhost:5000`

### 1. Install dependencies

```bash
cd client
npm install
```

### 2. Create `.env.local`

```env
VITE_SIGNALING_URL=http://localhost:5000
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

> Supabase variables are only required if you use the `/login` route. The meeting room itself works without them.

### 3. Start the dev server

```bash
npm run dev
# → http://localhost:5173
```

### Other scripts

```bash
npm run build    # production build → dist/
npm run preview  # preview the production build locally
npm run lint     # run ESLint
```

---

## Architecture Overview

```
src/
├── main.jsx              # React entry point; mounts <App>
├── App.jsx               # BrowserRouter + route declarations
│
├── pages/
│   ├── Home.jsx          # Landing page: create a room (random ID) or join by code
│   ├── Room.jsx          # Meeting room (all SFU logic + chat + video grid)
│   └── Login.jsx         # Supabase email/password login
│
├── components/
│   ├── VideoTile.jsx     # <video> wrapper; accepts a MediaStream prop
│   ├── AudioTile.jsx     # <audio> wrapper; plays remote audio without muting
│   └── PrivateRoute.jsx  # Redirects unauthenticated users to /login
│
└── supabase.js           # Initialises the Supabase client from env vars
```

**Key state flow in `Room.jsx`:**

```
joinMeeting()
  └─ connect socket
  └─ sfu:join          → load mediasoup Device
  └─ sfu:createTransport (send + recv)
  └─ getUserMedia()    → setUserStream
  └─ sfu:produce (audio + video)
  └─ sfu:getProducers  → consumeProducer() for each existing peer
  └─ listen sfu:newProducer → consumeProducer() for late joiners
       └─ sfu:consume → sfu:resume → addRemoteTrack() → re-render grid
```

---

## Known Limitations / What I'd Improve

- **No simulcast** — a single video quality layer is produced; switching layers based on network conditions would need simulcast or SVC support.
- **Peer labels are socket IDs** — showing the first 6 characters of a socket ID is fine for a demo but should be replaced with display names.
- **Chat is in-memory on the server** — chat history is lost if the server restarts; it should be persisted (e.g., in a database).
- **Audio autoplay may be blocked** — some browsers require a user gesture before playing audio; a workaround prompt could improve first-join UX.
- **No mobile camera switching** — `getUserMedia` defaults to the front camera on mobile; a toggle button for front/rear cam is a straightforward improvement.
