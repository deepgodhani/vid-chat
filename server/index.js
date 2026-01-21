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
const chatHistoryByRoom = new Map();
// ...existing code...

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
  
    // ✅ single signaling route
    socket.on("signal", ({ to, from, signal }) => {
      io.to(to).emit("signal", { from, signal });
    });


    socket.on("chat:send", ({ roomId, text }) => {
        const actualRoom = socketToRoom[socket.id];
    
        // must be joined and must match the room they joined
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
    
    // ❌ remove old handlers (they conflict / are unused now)
    // socket.on("sending signal", ...)
    // socket.on("returning signal", ...)
  
    socket.on("disconnect", () => {
      const roomID = socketToRoom[socket.id];
      if (!roomID) return;
  
      users[roomID] = (users[roomID] || []).filter((id) => id !== socket.id);
      socket.to(roomID).emit("user left", socket.id);
  
      delete socketToRoom[socket.id];
      if (users[roomID]?.length === 0) delete users[roomID];

      if (!users[roomID] || users[roomID].length === 0) {
        chatHistoryByRoom.delete(roomID);
      }
    });
  });
  

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));