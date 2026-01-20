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
    socket.on("join room", roomID => {
        if (rooms[roomID]) {
            rooms[roomID].push(socket.id);
        } else {
            rooms[roomID] = [socket.id];
        }
        
        // Get all other users in this room
        const usersInRoom = rooms[roomID].filter(id => id !== socket.id);
        
        // Send the list of existing users to the new client
        socket.emit("all users", usersInRoom);
    });

    // Relay the offer from the initiator to a specific user
    socket.emit("sending signal", payload => {
        io.to(payload.userToSignal).emit('user joined', { signal: payload.signal, callerID: payload.callerID });
    });

    // Relay the answer back to the initiator
    socket.on("returning signal", payload => {
        io.to(payload.callerID).emit('receiving returned signal', { signal: payload.signal, id: socket.id });
    });

    socket.on("disconnect", () => {
        // Remove user from all rooms
        for (let key in rooms) {
            const index = rooms[key].indexOf(socket.id);
            if (index >= 0) {
                rooms[key].splice(index, 1);
            }
        }
        // Notify others that this user left (Optional but recommended for cleanup)
        socket.broadcast.emit("user left", socket.id); 
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));