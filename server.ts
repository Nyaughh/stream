import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

interface RoomMember {
  id: string;
  name: string;
  image?: string;
}

interface VideoState {
  url: string;
  timestamp: number;
  isPlaying: boolean;
}

interface RoomState {
  members: Map<string, RoomMember>;
  videoState?: VideoState;
}

// Initialize rooms state
const rooms = new Map<string, RoomState>();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "development" 
      ? "http://localhost:3000" 
      : process.env.NEXT_PUBLIC_SITE_URL,
    methods: ["GET", "POST"],
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on("join-room", ({ roomId, user }: { roomId: string; user: RoomMember }) => {
    socket.join(roomId);
    
    // Initialize room state if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { members: new Map() });
    }
    
    // Add member to room state
    const room = rooms.get(roomId)!;
    room.members.set(user.id, user);
    
    // Send current members to the joining user
    const members = Array.from(room.members.values());
    socket.emit("room-state", { members });
    
    // Notify others in the room
    socket.to(roomId).emit("member-joined", user);
    
    console.log(`User ${user.name} joined room ${roomId}`);
    console.log('Current room members:', members);
  });

  socket.on("leave-room", ({ roomId, user }: { roomId: string; user: RoomMember }) => {
    socket.leave(roomId);
    
    // Remove member from room state
    const room = rooms.get(roomId);
    if (room) {
      room.members.delete(user.id);
      
      // Notify others in the room
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

  socket.on("sync-url", ({ roomId, url, timestamp = 0 }: { roomId: string; url: string; timestamp?: number }) => {
    // Convert YouTube URLs to embed format
    const embedUrl = convertToEmbedUrl(url);
    
    // Update room's video state
    const room = rooms.get(roomId);
    if (room) {
      room.videoState = {
        url: embedUrl,
        timestamp,
        isPlaying: true
      };
    }
    
    // Broadcast to others in the room
    socket.to(roomId).emit("url-changed", {
      url: embedUrl,
      timestamp
    });
  });

  // New event handlers for video synchronization
  socket.on("video-state-change", ({ roomId, isPlaying, timestamp }: { roomId: string; isPlaying: boolean; timestamp: number }) => {
    const room = rooms.get(roomId);
    if (room?.videoState) {
      room.videoState.isPlaying = isPlaying;
      room.videoState.timestamp = timestamp;
    }
    
    socket.to(roomId).emit("video-state-updated", {
      isPlaying,
      timestamp
    });
  });

  socket.on("request-video-state", ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (room?.videoState) {
      socket.emit("video-state-updated", room.videoState);
    }
  });

  socket.on("chat-message", ({ roomId, message, user }: { roomId: string; message: string; user: RoomMember }) => {
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

// Error handling
io.on('error', (error) => {
  console.error('Socket.IO Error:', error);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Helper function to convert YouTube URLs to embed format
function convertToEmbedUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Handle youtube.com/watch?v= format
    if (urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com') {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
      }
    }
    
    // Handle youtu.be format
    if (urlObj.hostname === 'youtu.be') {
      const videoId = urlObj.pathname.slice(1);
      return `https://www.youtube.com/embed/${videoId}`;
    }
    
    // Return original URL if not a YouTube URL
    return url;
  } catch {
    // Return original URL if parsing fails
    return url;
  }
}

const PORT = process.env.SOCKET_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 