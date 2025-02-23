const socket = io('ws://localhost:3001', {
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  autoConnect: true,
  transports: ['websocket'],
});

socket.on('connect_error', (error) => {
  console.warn('Socket connection error:', error);
  // Add custom error handling here
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log(`Attempting to reconnect... (${attemptNumber})`);
}); 