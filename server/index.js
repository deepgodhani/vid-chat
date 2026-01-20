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
    // 1. Join Room Event
    socket.on("join room", roomID => {
        // Initialize room if it doesn't exist
        if (!rooms[roomID]) {
            rooms[roomID] = [];
        }

        // FIX: Only add the user if they are NOT already in the room
        if (!rooms[roomID].includes(socket.id)) {
             rooms[roomID].push(socket.id);
             
             // Only notify others if this is a NEW join
             const otherUser = rooms[roomID].find(id => id !== socket.id);
             if (otherUser) {
                 socket.emit("other user", otherUser);
                 socket.to(otherUser).emit("user joined", socket.id);
             }
        }
    });

    // 2. Relay Offer (The Call)
    socket.on("offer", payload => {
        io.to(payload.target).emit("offer", payload);
    });

    // 3. Relay Answer (The Response)
    socket.on("answer", payload => {
        io.to(payload.target).emit("answer", payload);
    });

    // 4. Relay ICE Candidates (Connectivity Info)
    socket.on("ice-candidate", incoming => {
        io.to(incoming.target).emit("ice-candidate", incoming.candidate);
    });
});

server.listen(5000, () => console.log('server is running on port 5000'));