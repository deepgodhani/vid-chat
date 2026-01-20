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
    // 1. Join Room
    socket.on("join room", roomID => {
        if (!rooms[roomID]) {
            rooms[roomID] = [];
        }

        // Add user if not already there
        if (!rooms[roomID].includes(socket.id)) {
            rooms[roomID].push(socket.id);
        }

        // Find the OTHER user (who is NOT me)
        const otherUser = rooms[roomID].find(id => id !== socket.id);
        if (otherUser) {
            socket.emit("other user", otherUser);
            socket.to(otherUser).emit("user joined", socket.id);
        }
    });

    // 2. Offer
    socket.on("offer", payload => {
        io.to(payload.target).emit("offer", payload);
    });

    // 3. Answer
    socket.on("answer", payload => {
        io.to(payload.target).emit("answer", payload);
    });

    // 4. ICE Candidate
    socket.on("ice-candidate", incoming => {
        io.to(incoming.target).emit("ice-candidate", incoming.candidate);
    });

    // 5. DISCONNECT HANDLER (The Fix)
    socket.on("disconnect", () => {
        // Go through all rooms and remove this user
        for (let roomID in rooms) {
            let index = rooms[roomID].indexOf(socket.id);
            if (index >= 0) {
                rooms[roomID].splice(index, 1);
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));