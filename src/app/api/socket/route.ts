import { Server as NetServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { NextResponse } from "next/server";
import { createServer } from "http";

interface RoomMember {
  id: string;
  name: string;
  image?: string;
}

interface RoomState {
  members: Map<string, RoomMember>;
}

declare global {
  var io: SocketIOServer | undefined;
  var rooms: Map<string, RoomState>;
}

if (!global.io) {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === "development" ? "http://localhost:3000" : "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Initialize rooms state
  global.rooms = new Map();

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-room", ({ roomId, user }: { roomId: string; user: RoomMember }) => {
      socket.join(roomId);
      
      // Initialize room state if it doesn't exist
      if (!global.rooms.has(roomId)) {
        global.rooms.set(roomId, { members: new Map() });
      }
      
      // Add member to room state
      const room = global.rooms.get(roomId)!;
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
      const room = global.rooms.get(roomId);
      if (room) {
        room.members.delete(user.id);
        
        // Notify others in the room before cleaning up
        socket.to(roomId).emit("member-left", user);
        
        // Clean up room if empty
        if (room.members.size === 0) {
          global.rooms.delete(roomId);
        } else {
          // Send updated room state to remaining members
          const members = Array.from(room.members.values());
          io.to(roomId).emit("room-state", { members });
        }
      }
      
      console.log(`User ${user.name} left room ${roomId}`);
    });

    socket.on("sync-url", ({ roomId, url }: { roomId: string; url: string }) => {
      socket.to(roomId).emit("url-changed", url);
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
      for (const [roomId, room] of global.rooms.entries()) {
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
              global.rooms.delete(roomId);
            }
          }
        }
      }
      
      console.log("Client disconnected:", socket.id);
    });
  });

  httpServer.listen(3001);
  global.io = io;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!global.io) {
    return new NextResponse("Socket server not initialized", { status: 500 });
  }
  return new NextResponse("Socket server is running", { status: 200 });
} 