const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

io.on("connection", socket => {
    // 1. Join Room Event (With Duplicate Fix)
    socket.on("join room", roomID => {
        if (!rooms[roomID]) {
            rooms[roomID] = [];
        }

        // Only add user if they aren't already there
        if (!rooms[roomID].includes(socket.id)) {
            rooms[roomID].push(socket.id);
        }

        // Notify the OTHER user (if exists)
        const otherUser = rooms[roomID].find(id => id !== socket.id);
        if (otherUser) {
            socket.emit("other user", otherUser);
            socket.to(otherUser).emit("user joined", socket.id);
        }
    });

    // 2. Offer (Call)
    socket.on("offer", payload => {
        io.to(payload.target).emit("offer", payload);
    });

    // 3. Answer (Response)
    socket.on("answer", payload => {
        io.to(payload.target).emit("answer", payload);
    });

    // 4. ICE Candidate (Connection Info)
    socket.on("ice-candidate", incoming => {
        io.to(incoming.target).emit("ice-candidate", incoming.candidate);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));