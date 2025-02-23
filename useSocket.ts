import { io, Socket } from 'socket.io-client';
import { useEffect, useRef } from 'react';

interface RoomMember {
  id: string;
  name: string;
  image?: string;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io('ws://localhost:3001', {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        autoConnect: true,
        transports: ['websocket'],
      });

      socketRef.current.on('connect_error', (error) => {
        console.warn('Socket connection error:', error);
      });

      socketRef.current.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Attempting to reconnect... (${attemptNumber})`);
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const joinRoom = (roomId: string, user: RoomMember) => {
    if (socketRef.current) {
      socketRef.current.emit('join-room', { roomId, user });
    }
  };

  const leaveRoom = (roomId: string, user: RoomMember) => {
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId, user });
    }
  };

  return {
    socket: socketRef.current,
    isConnected: socketRef.current?.connected ?? false,
    joinRoom,
    leaveRoom,
  };
} 