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

const users = {}; // Key: Room ID, Value: Array of Socket IDs

io.on("connection", socket => {
    socket.on("join room", roomID => {
        if (users[roomID]) {
            users[roomID].push(socket.id);
        } else {
            users[roomID] = [socket.id];
        }
        
        // 1. Send the array of OTHER users to the new joiner
        const usersInThisRoom = users[roomID].filter(id => id !== socket.id);
        socket.emit("all users", usersInThisRoom);
    });

    // 2. Relay the signal (Offer) from New User -> Existing User
    socket.on("sending signal", payload => {
        io.to(payload.userToSignal).emit('user joined', { signal: payload.signal, callerID: payload.callerID });
    });

    // 3. Relay the signal (Answer) from Existing User -> New User
    socket.on("returning signal", payload => {
        io.to(payload.callerID).emit('receiving returned signal', { signal: payload.signal, id: socket.id });
    });

    socket.on("disconnect", () => {
        // Remove user from all rooms
        for (const roomID in users) {
            let roomUsers = users[roomID];
            if (roomUsers.includes(socket.id)) {
                users[roomID] = roomUsers.filter(id => id !== socket.id);
                // Optional: Notify others that user left to remove their video
                socket.broadcast.emit("user left", socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));