import React, { useState, useEffect } from 'react';
import { Container, Typography, Box } from '@mui/material';
import CreateRoom from './components/CreateRoom';
import GameRoom from './components/GameRoom';
import { Socket } from 'socket.io-client';

function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handleUnload = () => {
      socket.disconnect();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [socket]);

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h2" component="h1" gutterBottom align="center">
          瞎掰王
        </Typography>
        {!roomId ? (
          <CreateRoom
            onRoomCreated={(id, name, sock) => {
              setRoomId(id);
              setPlayerName(name);
              setSocket(sock);
            }}
          />
        ) : (
          socket && <GameRoom roomId={roomId} playerName={playerName} socket={socket} />
        )}
      </Box>
    </Container>
  );
}

export default App;
