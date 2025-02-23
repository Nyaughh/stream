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
import { LogOut } from "lucide-react";
import { Play, Users, MessageSquare, Tv } from "lucide-react";

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

const SYNC_THRESHOLD = 2; // seconds
const SYNC_INTERVAL = 5000; // milliseconds

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
  const [isCopied, setIsCopied] = useState(false);
  
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
        if (!seeking) {
          setIsPlaying(isPlaying);
          const currentTime = playerRef.current?.getCurrentTime() ?? 0;
          if (needsSync(currentTime, timestamp)) {
            playerRef.current?.seekTo(timestamp, 'seconds');
          }
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

  useEffect(() => {
    if (isInRoom && playerRef.current) {
      const syncInterval = setInterval(() => {
        if (!seeking && playerRef.current) {
          const currentTime = playerRef.current.getCurrentTime();
          socket.syncVideoState(roomId, isPlaying, currentTime);
        }
      }, SYNC_INTERVAL);

      return () => clearInterval(syncInterval);
    }
  }, [isInRoom, roomId, seeking, isPlaying]);

  useEffect(() => {
    if (isInRoom && url) {
      const currentTime = playerRef.current?.getCurrentTime() ?? 0;
      updateUrlMutation.mutate({ roomId, url });
      socket.syncUrl(roomId, url, currentTime);
      setError(null);
    }
  }, [url, isInRoom]);

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
    if (isInRoom && !seeking) {
      setIsPlaying(true);
      const currentTime = playerRef.current?.getCurrentTime() ?? 0;
      socket.syncVideoState(roomId, true, currentTime);
    }
  }, [isInRoom, roomId, seeking]);

  const handlePause = useCallback(() => {
    if (isInRoom && !seeking) {
      setIsPlaying(false);
      const currentTime = playerRef.current?.getCurrentTime() ?? 0;
      socket.syncVideoState(roomId, false, currentTime);
    }
  }, [isInRoom, roomId, seeking]);

  const handleSeek = useCallback((seconds: number) => {
    if (isInRoom && !seeking) {
      setSeeking(true);
      socket.syncVideoState(roomId, isPlaying, seconds);
      setTimeout(() => setSeeking(false), 1000);
    }
  }, [isInRoom, roomId, isPlaying, seeking]);

  const needsSync = useCallback((currentTime: number, targetTime: number) => {
    return Math.abs(currentTime - targetTime) > SYNC_THRESHOLD;
  }, []);

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

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy room ID:', err);
    }
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
    <div className="min-h-screen bg-[#030711] text-cyan-400 p-4 overflow-hidden">
      {/* Enhanced background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]"></div>
      <div className="absolute inset-0 bg-[url('/grid.png')] opacity-[0.02]"></div>

      <div className="max-w-7xl mx-auto relative z-10">
        {!session ? (
          <div className="flex flex-col items-center justify-center min-h-screen gap-6">
            <h1 className="text-5xl font-mono tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-cyan-200 to-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.25)]">
              NEON SYNC
            </h1>
            <Button 
              onClick={() => signIn("discord")}
              className="bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 font-mono px-8 py-6 text-lg shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all duration-300 hover:shadow-[0_0_25px_rgba(34,211,238,0.25)]"
            >
              CONNECT
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-950/30 border border-red-500/50 text-red-400 rounded-md font-mono text-sm shadow-[0_0_15px_rgba(239,68,68,0.15)]">
                {error}
              </div>
            )}
            <header className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-mono tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-cyan-200 to-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.25)]">
                NEON SYNC
              </h1>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3 bg-cyan-400/5 pl-1 pr-2 py-1 rounded border border-cyan-400/20">
                  <img 
                    src={session.user?.image ?? ""} 
                    alt={session.user?.name ?? ""} 
                    className="h-8 w-8 border border-cyan-400/30"
                  />
                  <span className="text-sm font-mono text-cyan-200">{session.user?.name?.toUpperCase()}</span>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => signOut()}
                  className="text-red-400 hover:text-red-300 hover:bg-red-950/30 px-4 py-2 font-mono text-sm border border-red-500/20 rounded hover:border-red-500/40 transition-all duration-300"
                >
                  DISCONNECT
                </Button>
              </div>
            </header>

            <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-4">
                <div className="aspect-video bg-black rounded-lg border border-cyan-400/20 shadow-[0_0_30px_rgba(34,211,238,0.1)] overflow-hidden">
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
                    <div className="flex items-center justify-center h-full bg-cyan-950/10">
                      <span className="text-cyan-400/50 font-mono text-lg tracking-widest animate-pulse">NO SIGNAL</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Input
                    placeholder="ENTER URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={!isInRoom || !socket.isConnected}
                    className="bg-black/50 border-cyan-400/30 focus:border-cyan-400 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
                  />
                  <Button
                    onClick={handleUrlChange}
                    disabled={!isInRoom || !socket.isConnected}
                    className="bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 font-mono"
                  >
                    SYNC
                  </Button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-cyan-950/10 rounded-lg border border-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                  <h2 className="text-sm font-mono mb-4 text-cyan-200 tracking-wider">ROOM CONTROL</h2>
                  {!isInRoom ? (
                    <div className="space-y-3">
                      <Button
                        onClick={createRoom}
                        className="w-full bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 font-mono shadow-[0_0_10px_rgba(34,211,238,0.15)] transition-all duration-300"
                        disabled={!socket.isConnected || createRoomMutation.status === 'pending'}
                      >
                        {createRoomMutation.status === 'pending' ? '...' : 'CREATE ROOM'}
                      </Button>
                      <Input
                        placeholder="ROOM ID"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
                        className="bg-black/50 border-cyan-400/30 focus:border-cyan-400 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
                      />
                      <Button
                        onClick={joinRoom}
                        disabled={!socket.isConnected}
                        className="w-full bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 font-mono shadow-[0_0_10px_rgba(34,211,238,0.15)] transition-all duration-300"
                      >
                        JOIN
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-black/30 rounded-md border border-cyan-400/30">
                        <div className="font-mono">
                          <div className="text-xs text-cyan-400/70">ROOM ID</div>
                          <div className="text-sm text-cyan-200">{roomId}</div>
                        </div>
                        <Button
                          onClick={copyRoomId}
                          variant="ghost"
                          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10 px-3 py-1.5 font-mono text-sm border border-cyan-400/20 rounded transition-all duration-300"
                        >
                          {isCopied ? 'COPIED' : 'COPY'}
                        </Button>
                      </div>
                      <div className="p-3 bg-black/30 rounded-md border border-cyan-400/30">
                        <div className="text-xs font-mono text-cyan-400/70 mb-2">USERS · {members.length}</div>
                        <div className="flex flex-wrap gap-2">
                          {members.map((member) => (
                            <div key={member.id} className="flex items-center gap-2 bg-cyan-400/5 px-2 py-1.5 rounded border border-cyan-400/20">
                              {member.image && (
                                <img src={member.image} alt={member.name} className="w-5 h-5 rounded-full border border-cyan-400/30" />
                              )}
                              <span className="text-xs font-mono text-cyan-200">{member.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <Button
                        onClick={leaveRoom}
                        className="w-full bg-red-950/30 hover:bg-red-950/50 border border-red-500/50 text-red-400 font-mono shadow-[0_0_10px_rgba(239,68,68,0.15)] transition-all duration-300"
                      >
                        DISCONNECT
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col h-[400px] p-4 bg-cyan-950/10 rounded-lg border border-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                  <h2 className="text-sm font-mono mb-4 text-cyan-200 tracking-wider">CHAT</h2>
                  <ScrollArea className="flex-grow mb-4 pr-4">
                    <div className="space-y-3">
                      {messages.map((msg, i) => (
                        <div
                          key={i}
                          className={`p-2 rounded border border-cyan-400/10 ${
                            msg.user.id === "system"
                              ? "bg-cyan-400/5 text-cyan-400/70 text-xs text-center"
                              : "bg-black/30"
                          }`}
                        >
                          {msg.user.id !== "system" && (
                            <div className="flex items-center gap-2 mb-2">
                              {msg.user.image && (
                                <img src={msg.user.image} alt={msg.user.name} className="w-5 h-5 rounded-full border border-cyan-400/30" />
                              )}
                              <span className="text-xs font-mono text-cyan-400/70">{msg.user.name}</span>
                            </div>
                          )}
                          <p className="text-sm font-mono text-cyan-200">{msg.text}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-3">
                    <Input
                      placeholder="MESSAGE"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                      disabled={!isInRoom || !socket.isConnected}
                      className="bg-black/50 border-cyan-400/30 focus:border-cyan-400 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!isInRoom || !socket.isConnected}
                      className="bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 font-mono"
                    >
                      SEND
                    </Button>
                  </div>
                </div>
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
} 