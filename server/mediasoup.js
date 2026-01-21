const mediasoup = require("mediasoup");
require("dotenv").config();

const rooms = new Map();

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {},
  },
];

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = mediasoup.createWorker({
      logLevel: "warn",
      logTags: ["ice", "dtls", "rtp", "srtp", "rtcp"],
      rtcMinPort: Number(process.env.RTC_MIN_PORT || 40000),
      rtcMaxPort: Number(process.env.RTC_MAX_PORT || 49999),
    });
  }
  return workerPromise;
}

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room) return room;

  const worker = await getWorker();
  const router = await worker.createRouter({ mediaCodecs });

  room = { id: roomId, router, peers: new Map() };
  rooms.set(roomId, room);
  return room;
}

function getPeer(room, socketId) {
  let peer = room.peers.get(socketId);
  if (!peer) {
    peer = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(socketId, peer);
  }
  return peer;
}

function cleanupPeer(room, socketId) {
  const peer = room.peers.get(socketId);
  if (!peer) return;

  for (const [, consumer] of peer.consumers) {
    try {
      consumer.close();
    } catch {}
  }
  for (const [, producer] of peer.producers) {
    try {
      producer.close();
    } catch {}
  }
  for (const [, transport] of peer.transports) {
    try {
      transport.close();
    } catch {}
  }

  room.peers.delete(socketId);

  if (room.peers.size === 0) {
    rooms.delete(room.id);
  }
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,

    rtcpMux: true,
    comedia: true,

    initialAvailableOutgoingBitrate: 1_000_000,
  });

  return transport;
}

module.exports = {
  rooms,
  getOrCreateRoom,
  getPeer,
  cleanupPeer,
  createWebRtcTransport,
};