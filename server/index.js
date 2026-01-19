const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);

const io = require("socket.io")(server, {
    cors: {
        origin: "*", // Allow ALL connections (Solves the Vercel error)
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    // 1. Send the user their own ID
    socket.emit("me", socket.id);

    // 2. Disconnect handler
    socket.on("disconnect", () => {
        socket.broadcast.emit("callEnded");
    });

    // 3. Call User
    socket.on("callUser", (data) => {
        io.to(data.userToCall).emit("callUser", { 
            signal: data.signalData, 
            from: data.from, 
            name: data.name 
        });
    });

    // 4. Answer Call
    socket.on("answerCall", (data) => {
        io.to(data.to).emit("callAccepted", data.signal);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));