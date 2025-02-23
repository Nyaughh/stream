import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

interface RoomMember {
  id: string;
  name: string;
  image?: string;
}

const getSocketUrl = () => {
  if (process.env.NODE_ENV === "production") {
    return process.env.NEXT_PUBLIC_WEBSOCKET_URL || "wss://your-websocket-server.com";
  }
  return "http://localhost:3001";
};

export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(getSocketUrl(), {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      autoConnect: true,
      transports: ["websocket"],
      withCredentials: true,
    });

    setSocket(newSocket);

    const onConnect = () => {
      console.log("Socket connected");
      setIsConnected(true);
    };

    const onDisconnect = () => {
      console.log("Socket disconnected");
      setIsConnected(false);
    };

    const onError = (error: Error) => {
      console.error("Socket connection error:", error);
      setIsConnected(false);
    };

    newSocket.on("connect", onConnect);
    newSocket.on("disconnect", onDisconnect);
    newSocket.on("connect_error", onError);

    return () => {
      newSocket.off("connect", onConnect);
      newSocket.off("disconnect", onDisconnect);
      newSocket.off("connect_error", onError);
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, []);

  const joinRoom = (roomId: string, user: RoomMember) => {
    if (socket && isConnected) {
      socket.emit("join-room", { roomId, user });
    }
  };

  const leaveRoom = (roomId: string, user: RoomMember) => {
    if (socket && isConnected) {
      socket.emit("leave-room", { roomId, user });
    }
  };

  const syncUrl = (roomId: string, url: string, timestamp: number = 0) => {
    if (socket && isConnected) {
      socket.emit("sync-url", { roomId, url, timestamp });
    }
  };

  const syncVideoState = (roomId: string, isPlaying: boolean, timestamp: number) => {
    if (socket && isConnected) {
      socket.emit("video-state-change", { roomId, isPlaying, timestamp });
    }
  };

  const requestVideoState = (roomId: string) => {
    if (socket && isConnected) {
      socket.emit("request-video-state", { roomId });
    }
  };

  const sendMessage = (roomId: string, message: string, user: RoomMember) => {
    if (socket && isConnected) {
      socket.emit("chat-message", { roomId, message, user });
    }
  };

  const onUrlChange = (callback: (data: { url: string; timestamp: number }) => void) => {
    if (socket && isConnected) {
      socket.on("url-changed", callback);
      return () => socket.off("url-changed", callback);
    }
    return () => {};
  };

  const onVideoStateUpdate = (callback: (state: { isPlaying: boolean; timestamp: number }) => void) => {
    if (socket && isConnected) {
      socket.on("video-state-updated", callback);
      return () => socket.off("video-state-updated", callback);
    }
    return () => {};
  };

  const onNewMessage = (callback: (message: { user: RoomMember; text: string; timestamp: string }) => void) => {
    if (socket && isConnected) {
      socket.on("new-message", callback);
      return () => socket.off("new-message", callback);
    }
    return () => {};
  };

  const onMemberJoin = (callback: (member: RoomMember) => void) => {
    if (socket && isConnected) {
      socket.on("member-joined", callback);
      return () => socket.off("member-joined", callback);
    }
    return () => {};
  };

  const onMemberLeave = (callback: (member: RoomMember) => void) => {
    if (socket && isConnected) {
      socket.on("member-left", callback);
      return () => socket.off("member-left", callback);
    }
    return () => {};
  };

  const onRoomState = (callback: (state: { members: RoomMember[] }) => void) => {
    if (socket && isConnected) {
      socket.on("room-state", callback);
      return () => socket.off("room-state", callback);
    }
    return () => {};
  };

  return {
    isConnected,
    joinRoom,
    leaveRoom,
    syncUrl,
    syncVideoState,
    requestVideoState,
    sendMessage,
    onUrlChange,
    onVideoStateUpdate,
    onNewMessage,
    onMemberJoin,
    onMemberLeave,
    onRoomState,
  };
}; 