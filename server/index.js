const express = require("express");
const http = require("http");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const socket = require("socket.io");

// ✅ lock CORS to your deployed frontend
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const io = socket(server, {
  cors: {
    origin: (origin, cb) => {
      // allow server-to-server / health checks
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // fallback if not set
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
});

app.get("/health", (req, res) => res.status(200).json({ ok: true }));

const users = {};
const socketToRoom = {};

io.on("connection", (socket) => {
  socket.on("join room", (roomID) => {
    if (!users[roomID]) users[roomID] = [];
    users[roomID].push(socket.id);
    socketToRoom[socket.id] = roomID;

    const usersInThisRoom = users[roomID].filter((id) => id !== socket.id);
    socket.emit("all users", usersInThisRoom);
  });

  socket.on("sending signal", (payload) => {
    io.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerID: payload.callerID,
    });
  });

  socket.on("returning signal", (payload) => {
    io.to(payload.callerID).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  socket.on("disconnect", () => {
    const roomID = socketToRoom[socket.id];
    if (!roomID) return;

    // remove from room list
    const room = users[roomID] || [];
    users[roomID] = room.filter((id) => id !== socket.id);

    // ✅ notify others so they remove the video tile
    socket.to(roomID).emit("user left", socket.id);

    delete socketToRoom[socket.id];
    if (users[roomID].length === 0) delete users[roomID];
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));