const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "production" 
      ? [process.env.NEXT_PUBLIC_APP_URL || "https://your-app-domain.com"]
      : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize rooms state
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-room", ({ roomId, user }) => {
    socket.join(roomId);
    
    // Initialize room state if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { members: new Map() });
    }
    
    // Add member to room state
    const room = rooms.get(roomId);
    room.members.set(user.id, user);
    
    // Send current members to the joining user
    const members = Array.from(room.members.values());
    socket.emit("room-state", { members });
    
    // Notify others in the room
    socket.to(roomId).emit("member-joined", user);
    
    console.log(`User ${user.name} joined room ${roomId}`);
    console.log('Current room members:', members);
  });

  socket.on("leave-room", ({ roomId, user }) => {
    socket.leave(roomId);
    
    // Remove member from room state
    const room = rooms.get(roomId);
    if (room) {
      room.members.delete(user.id);
      
      // Notify others in the room before cleaning up
      socket.to(roomId).emit("member-left", user);
      
      // Clean up room if empty
      if (room.members.size === 0) {
        rooms.delete(roomId);
      } else {
        // Send updated room state to remaining members
        const members = Array.from(room.members.values());
        io.to(roomId).emit("room-state", { members });
      }
    }
    
    console.log(`User ${user.name} left room ${roomId}`);
  });

  socket.on("sync-url", ({ roomId, url, timestamp }) => {
    socket.to(roomId).emit("url-changed", { url, timestamp });
  });

  socket.on("video-state-change", ({ roomId, isPlaying, timestamp }) => {
    socket.to(roomId).emit("video-state-updated", { isPlaying, timestamp });
  });

  socket.on("chat-message", ({ roomId, message, user }) => {
    io.to(roomId).emit("new-message", {
      user,
      text: message,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    // Clean up any rooms the user was in
    for (const [roomId, room] of rooms.entries()) {
      for (const [userId, user] of room.members.entries()) {
        if (userId === socket.id) {
          room.members.delete(userId);
          socket.to(roomId).emit("member-left", user);
          
          // Send updated room state to remaining members
          if (room.members.size > 0) {
            const members = Array.from(room.members.values());
            io.to(roomId).emit("room-state", { members });
          }
          
          // Clean up room if empty
          if (room.members.size === 0) {
            rooms.delete(roomId);
          }
        }
      }
    }
    
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
}); 