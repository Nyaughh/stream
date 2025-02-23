"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useSocket } from "../../hooks/useSocket";
import { signIn, signOut, useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import ReactPlayer from 'react-player';

interface RoomMember {
  id: string;
  name: string;
  image?: string;
}

interface Message {
  user: RoomMember;
  text: string;
  timestamp: string;
}

export default function WatchTogether() {
  const { data: session, status } = useSession();
  const [url, setUrl] = useState("");
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [isInRoom, setIsInRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<ReactPlayer>(null);
  const [seeking, setSeeking] = useState(false);
  
  const socket = useSocket();
  const utils = api.useUtils();

  const getCurrentUser = (): RoomMember | null => {
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name ?? "Anonymous",
      image: session.user.image ?? undefined,
    };
  };

  const createRoomMutation = api.room.create.useMutation({
    onSuccess: (room) => {
      setRoomId(room.id);
      const user = getCurrentUser();
      if (user) {
        socket.joinRoom(room.id, user);
        setMembers([user]); // Add self to members list
      }
      setIsInRoom(true);
      setError(null);
    },
    onError: (error) => {
      console.error('Room creation error:', error);
      setError(error.message);
    }
  });

  const joinRoomMutation = api.room.join.useMutation({
    onSuccess: (room) => {
      const user = getCurrentUser();
      if (user) {
        socket.joinRoom(room.id, user);
        setMembers([user]); // Add self to members list
      }
      setIsInRoom(true);
      setError(null);
    },
  });

  const leaveRoomMutation = api.room.leave.useMutation({
    onSuccess: () => {
      const user = getCurrentUser();
      if (user) {
        socket.leaveRoom(roomId, user);
      }
      setIsInRoom(false);
      setMessages([]);
      setMembers([]);
      setUrl("");
      setError(null);
    },
  });

  const updateUrlMutation = api.room.updateUrl.useMutation();
  const sendMessageMutation = api.room.sendMessage.useMutation();

  useEffect(() => {
    if (!socket?.isConnected) {
      setError("Connecting to server...");
    } else {
      setError(null);
    }
  }, [socket?.isConnected]);

  useEffect(() => {
    if (socket?.isConnected) {
      const unsubscribeUrl = socket.onUrlChange(({ url, timestamp }) => {
        setUrl(url);
        if (playerRef.current) {
          playerRef.current.seekTo(timestamp, 'seconds');
        }
      });

      const unsubscribeMessage = socket.onNewMessage((msg: { user: RoomMember; text: string; timestamp: string }) => {
        setMessages((prev) => [...prev, msg]);
      });

      const unsubscribeMemberJoin = socket.onMemberJoin((member: RoomMember) => {
        setMembers((prev) => [...prev, member]);
        setMessages((prev) => [
          ...prev,
          {
            user: { id: "system", name: "System" },
            text: `${member.name} joined the room`,
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      const unsubscribeMemberLeave = socket.onMemberLeave((member: RoomMember) => {
        setMembers((prev) => prev.filter((m) => m.id !== member.id));
        setMessages((prev) => [
          ...prev,
          {
            user: { id: "system", name: "System" },
            text: `${member.name} left the room`,
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      const unsubscribeRoomState = socket.onRoomState((state) => {
        console.log('Received room state:', state);
        setMembers(state.members);
        // Add a system message showing all current members
        setMessages((prev) => [
          ...prev,
          {
            user: { id: "system", name: "System" },
            text: `Current room members: ${state.members.map(m => m.name).join(', ')}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      const unsubscribeVideoState = socket.onVideoStateUpdate(({ isPlaying, timestamp }) => {
        setIsPlaying(isPlaying);
        if (!seeking && playerRef.current) {
          playerRef.current.seekTo(timestamp, 'seconds');
        }
      });

      return () => {
        unsubscribeUrl();
        unsubscribeMessage();
        unsubscribeMemberJoin();
        unsubscribeMemberLeave();
        unsubscribeRoomState();
        unsubscribeVideoState();
      };
    }
  }, [socket?.isConnected]);

  const createRoom = () => {
    if (!session) {
      console.log('No session found, redirecting to sign in');
      signIn("discord");
      return;
    }
    console.log('Creating room with session:', {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email
    });
    createRoomMutation.mutate({ name: "New Room" });
  };

  const joinRoom = () => {
    if (!session) {
      signIn("discord");
      return;
    }
    if (!roomId) {
      setError("Please enter a room ID");
      return;
    }
    joinRoomMutation.mutate({ roomId });
  };

  const leaveRoom = () => {
    if (roomId) {
      leaveRoomMutation.mutate({ roomId });
    }
  };

  const handleUrlChange = () => {
    if (!session) {
      signIn("discord");
      return;
    }
    if (!url) {
      setError("Please enter a URL");
      return;
    }
    if (isInRoom) {
      const currentTime = playerRef.current?.getCurrentTime() ?? 0;
      updateUrlMutation.mutate({ roomId, url });
      socket.syncUrl(roomId, url, currentTime);
      setError(null);
    }
  };

  const handlePlay = useCallback(() => {
    if (isInRoom) {
      setIsPlaying(true);
      socket.syncVideoState(roomId, true, playerRef.current?.getCurrentTime() ?? 0);
    }
  }, [isInRoom, roomId]);

  const handlePause = useCallback(() => {
    if (isInRoom) {
      setIsPlaying(false);
      socket.syncVideoState(roomId, false, playerRef.current?.getCurrentTime() ?? 0);
    }
  }, [isInRoom, roomId]);

  const handleSeek = useCallback((seconds: number) => {
    if (isInRoom) {
      setSeeking(true);
      socket.syncVideoState(roomId, isPlaying, seconds);
      setTimeout(() => setSeeking(false), 1000);
    }
  }, [isInRoom, roomId, isPlaying]);

  const sendMessage = () => {
    if (!session) {
      signIn("discord");
      return;
    }
    if (!message.trim() || !isInRoom) return;
    
    const user = getCurrentUser();
    if (!user) return;
    
    sendMessageMutation.mutate({ roomId, text: message });
    socket.sendMessage(roomId, message, user);
    setMessage("");
    setError(null);
  };

  if (status === "loading") {
    return (
      <main className="container mx-auto p-4">
        <div className="flex items-center justify-center min-h-screen">
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4">
      {!session ? (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <h1 className="text-4xl font-bold">Watch Together</h1>
          <p className="text-xl text-gray-600">Sign in to start watching with friends</p>
          <Button onClick={() => signIn("discord")}>Sign in with Discord</Button>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded-md">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <img
                src={session.user?.image ?? ""}
                alt={session.user?.name ?? ""}
                className="w-10 h-10 rounded-full"
              />
              <span className="font-medium">{session.user?.name}</span>
            </div>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Main content area */}
            <div className="md:col-span-2">
              <Card className="p-4">
                <div className="flex gap-2 mb-4">
                  <Input 
                    placeholder="Enter website URL" 
                    value={url} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                  />
                  <Button onClick={handleUrlChange} disabled={!isInRoom || !socket.isConnected}>
                    Load
                  </Button>
                </div>
                <div className="aspect-video bg-gray-800 rounded-lg">
                  {url ? (
                    <ReactPlayer
                      ref={playerRef}
                      url={url}
                      width="100%"
                      height="100%"
                      playing={isPlaying}
                      controls={true}
                      onPlay={handlePlay}
                      onPause={handlePause}
                      onSeek={handleSeek}
                      config={{
                        youtube: {
                          playerVars: { 
                            origin: window.location.origin,
                            modestbranding: 1,
                          }
                        }
                      }}
                    />
                  ) : (
                    <p className="text-white text-center p-4">Enter a URL to start watching</p>
                  )}
                </div>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <Card className="p-4">
                <h2 className="text-lg font-bold mb-4">Room Controls</h2>
                <div className="space-y-2">
                  {!isInRoom ? (
                    <>
                      <Button 
                        onClick={createRoom} 
                        className="w-full"
                        disabled={!socket.isConnected}
                      >
                        Create Room
                      </Button>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Room ID" 
                          value={roomId} 
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomId(e.target.value)}
                        />
                        <Button 
                          onClick={joinRoom}
                          disabled={!socket.isConnected}
                        >
                          Join
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-2 bg-gray-100 rounded mb-2">
                        <p className="font-medium">Room ID: {roomId}</p>
                        <p className="text-sm text-gray-500">Share this ID with your friends</p>
                      </div>
                      <div className="p-2 bg-gray-100 rounded mb-2">
                        <p className="font-medium">Room Members ({members.length})</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {members.map((member) => (
                            <div key={member.id} className="flex items-center gap-2 bg-white p-1 rounded">
                              {member.image && (
                                <img src={member.image} alt={member.name} className="w-6 h-6 rounded-full" />
                              )}
                              <span className="text-sm">{member.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <Button onClick={leaveRoom} variant="destructive" className="w-full">
                        Leave Room
                      </Button>
                    </>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <h2 className="text-lg font-bold mb-4">Chat</h2>
                <ScrollArea className="h-[300px] mb-4">
                  <div className="space-y-2">
                    {messages.map((msg, i) => (
                      <div 
                        key={i} 
                        className={`p-2 rounded ${
                          msg.user.id === "system" 
                            ? "bg-gray-100 text-gray-600 text-sm text-center" 
                            : "bg-gray-100"
                        }`}
                      >
                        {msg.user.id !== "system" && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <div className="flex items-center gap-2">
                              {msg.user.image && (
                                <img src={msg.user.image} alt={msg.user.name} className="w-6 h-6 rounded-full" />
                              )}
                              <span className="font-bold">{msg.user.name}</span>
                            </div>
                            <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                          </div>
                        )}
                        <p className={msg.user.id === "system" ? "text-center" : ""}>{msg.text}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Type a message" 
                    value={message}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
                    onKeyPress={(e: React.KeyboardEvent) => e.key === "Enter" && sendMessage()}
                    disabled={!isInRoom || !socket.isConnected}
                  />
                  <Button 
                    onClick={sendMessage} 
                    disabled={!isInRoom || !socket.isConnected}
                  >
                    Send
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </main>
  );
} 