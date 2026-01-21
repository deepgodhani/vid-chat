const express = require("express");
const http = require("http");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const socket = require("socket.io");

const {
  getOrCreateRoom,
  getPeer,
  createWebRtcTransport,
  cleanupPeer,
} = require("./mediasoup");

// lock CORS to your deployed frontend
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = socket(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
});

app.get("/health", (req, res) => res.status(200).json({ ok: true }));

const users = {};
const socketToRoom = {};

// temp chat per room
const chatHistoryByRoom = new Map();
function pushRoomMessage(roomId, msg, limit = 50) {
  const list = chatHistoryByRoom.get(roomId) || [];
  list.push(msg);
  if (list.length > limit) list.splice(0, list.length - limit);
  chatHistoryByRoom.set(roomId, list);
}

io.on("connection", (socket) => {
  socket.on("join room", (roomID) => {
    if (!users[roomID]) users[roomID] = [];
    users[roomID].push(socket.id);
    socketToRoom[socket.id] = roomID;
    socket.join(roomID);

    const history = chatHistoryByRoom.get(roomID) || [];
    socket.emit("chat:history", history);

    const usersInThisRoom = users[roomID].filter((id) => id !== socket.id);
    socket.emit("all users", usersInThisRoom);

    socket.to(roomID).emit("peer joined", { peerID: socket.id });
  });

  // legacy mesh signaling (client won’t use after SFU change)
  socket.on("signal", ({ to, from, signal }) => {
    io.to(to).emit("signal", { from, signal });
  });

  // chat
  socket.on("chat:send", ({ roomId, text }) => {
    const actualRoom = socketToRoom[socket.id];
    if (!actualRoom || actualRoom !== roomId) return;

    const msgText = typeof text === "string" ? text.trim() : "";
    if (!msgText) return;

    const msg = {
      id: `${Date.now()}-${socket.id}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      roomId,
      from: socket.id,
      text: msgText.slice(0, 2000),
    };

    pushRoomMessage(roomId, msg);
    io.to(roomId).emit("chat:message", msg);
  });



  socket.on("sfu:join", async ({ roomId }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      getPeer(room, socket.id); // ensure peer exists
      socket.join(roomId);

      cb?.({
        rtpCapabilities: room.router.rtpCapabilities,
      });
    } catch (e) {
      console.error("sfu:join failed", e);
      cb?.({ error: "sfu_join_failed" });
    }
  });

  socket.on("sfu:leave", async ({ roomId }, cb) => {
    try {
      const { rooms } = require("./mediasoup");
      const room = rooms.get(roomId);
      if (room) cleanupPeer(room, socket.id);
      cb?.({ ok: true });
    } catch (e) {
      console.error("sfu:leave failed", e);
      cb?.({ error: "sfu_leave_failed" });
    }
  });

  socket.on("sfu:createTransport", async ({ roomId, direction }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      const peer = getPeer(room, socket.id);

      const transport = await createWebRtcTransport(room.router);
      peer.transports.set(transport.id, transport);

      transport.on("dtlsstatechange", (state) => {
        if (state === "closed") {
          try {
            transport.close();
          } catch {}
          peer.transports.delete(transport.id);
        }
      });

      cb?.({
        id: transport.id,
        direction,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (e) {
      console.error("sfu:createTransport failed", e);
      cb?.({ error: "sfu_create_transport_failed" });
    }
  });

  socket.on("sfu:connectTransport", async ({ roomId, transportId, dtlsParameters }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      const peer = getPeer(room, socket.id);

      const transport = peer.transports.get(transportId);
      if (!transport) return cb?.({ error: "transport_not_found" });

      await transport.connect({ dtlsParameters });
      cb?.({ ok: true });
    } catch (e) {
      console.error("sfu:connectTransport failed", e);
      cb?.({ error: "sfu_connect_transport_failed" });
    }
  });

  socket.on("sfu:produce", async ({ roomId, transportId, kind, rtpParameters, appData }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      const peer = getPeer(room, socket.id);

      const transport = peer.transports.get(transportId);
      if (!transport) return cb?.({ error: "transport_not_found" });

      const producer = await transport.produce({ kind, rtpParameters, appData });
      peer.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });

      // notify others in room
      socket.to(roomId).emit("sfu:newProducer", {
        producerId: producer.id,
        kind: producer.kind,
        peerId: socket.id,
        appData: producer.appData || {},
      });

      cb?.({ id: producer.id });
    } catch (e) {
      console.error("sfu:produce failed", e);
      cb?.({ error: "sfu_produce_failed" });
    }
  });

  socket.on("sfu:getProducers", async ({ roomId }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);

      const list = [];
      for (const [peerId, peer] of room.peers.entries()) {
        if (peerId === socket.id) continue;
        for (const [producerId, producer] of peer.producers.entries()) {
          list.push({
            producerId,
            kind: producer.kind,
            peerId,
            appData: producer.appData || {},
          });
        }
      }

      cb?.({ producers: list });
    } catch (e) {
      console.error("sfu:getProducers failed", e);
      cb?.({ error: "sfu_get_producers_failed" });
    }
  });

  socket.on("sfu:consume", async ({ roomId, transportId, producerId, rtpCapabilities }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      const peer = getPeer(room, socket.id);

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return cb?.({ error: "cannot_consume" });
      }

      const transport = peer.transports.get(transportId);
      if (!transport) return cb?.({ error: "transport_not_found" });

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      // socket.on("sfu:leave", async ({ roomId }, cb) => { ... });

      peer.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        try {
          consumer.close();
        } catch {}
        socket.emit("sfu:producerClosed", { producerId });
      });

      cb?.({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (e) {
      console.error("sfu:consume failed", e);
      cb?.({ error: "sfu_consume_failed" });
    }
  });

  socket.on("sfu:resume", async ({ roomId, consumerId }, cb) => {
    try {
      const { rooms } = require("./mediasoup");
      const room = rooms.get(roomId);
      if (!room) return cb?.({ error: "room_not_found" });

      const peer = getPeer(room, socket.id);
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) return cb?.({ error: "consumer_not_found" });

      await consumer.resume();
      cb?.({ ok: true });
    } catch (e) {
      console.error("sfu:resume failed", e);
      cb?.({ error: "sfu_resume_failed" });
    }
  });

  socket.on("disconnect", async () => {
    const roomID = socketToRoom[socket.id];

    if (roomID) {
      users[roomID] = (users[roomID] || []).filter((id) => id !== socket.id);
      socket.to(roomID).emit("user left", socket.id);
      delete socketToRoom[socket.id];

      if (!users[roomID] || users[roomID].length === 0) {
        delete users[roomID];
        chatHistoryByRoom.delete(roomID);
      }
    }

    // mediasoup cleanup
    try {
        const { rooms } = require("./mediasoup");
        for (const [, room] of rooms.entries()) {
          cleanupPeer(room, socket.id);
        }
    } catch {
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));