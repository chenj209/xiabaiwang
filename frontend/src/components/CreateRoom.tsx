import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Tabs, Tab, Alert } from '@mui/material';
import { io, Socket } from 'socket.io-client';

interface CreateRoomProps {
  onRoomCreated: (roomId: string, playerName: string, playerId: string, socket: Socket) => void;
}

const CreateRoom: React.FC<CreateRoomProps> = ({ onRoomCreated }) => {
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [roomId, setRoomId] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Use the current window location to determine the backend URL
  const backendUrl = window.location.protocol === 'https:' 
    ? `https://${window.location.hostname}:3001`
    : `http://${window.location.hostname}:3001`;

  const handleCreateRoom = () => {
    if (playerName.trim()) {
      setError(null);
      const socket = io(backendUrl, {
        transports: ['polling'],
        withCredentials: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
        forceNew: true,
        autoConnect: true
      });
      
      socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        setError('连接服务器失败，请稍后重试');
      });

      socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('createRoom', maxPlayers);
      });

      socket.on('roomCreated', (data) => {
        socket.emit('joinRoom', { roomId: data.id, playerName });
        socket.on('playerJoined', (room) => {
          onRoomCreated(room.id, playerName, socket.id || '', socket);
        });
        socket.on('error', (errorMessage: string) => {
          setError(errorMessage);
          socket.disconnect();
        });
      });
    }
  };

  const handleJoinRoom = () => {
    if (playerName.trim() && roomId.trim()) {
      setError(null);
      const socket = io(backendUrl, {
        transports: ['polling'],
        withCredentials: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
        forceNew: true,
        autoConnect: true
      });

      socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        setError('连接服务器失败，请稍后重试');
      });

      socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('joinRoom', { roomId, playerName });
      });

      socket.on('playerJoined', (room) => {
        onRoomCreated(room.id, playerName, socket.id || '', socket);
      });
      socket.on('error', (errorMessage: string) => {
        setError(errorMessage);
        socket.disconnect();
      });
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setError(null);
  };

  return (
    <Box sx={{ maxWidth: 400, mx: 'auto', mt: 4 }}>
      <Tabs value={activeTab} onChange={handleTabChange} centered sx={{ mb: 3 }}>
        <Tab label="创建房间" />
        <Tab label="加入房间" />
      </Tabs>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <TextField
        fullWidth
        label="你的名字"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        margin="normal"
      />
      {activeTab === 0 ? (
        <>
          <TextField
            fullWidth
            type="number"
            label="最大玩家数"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            margin="normal"
            inputProps={{ min: 3, max: 9 }}
          />
          <Button
            fullWidth
            variant="contained"
            onClick={handleCreateRoom}
            disabled={!playerName.trim()}
            sx={{ mt: 2 }}
          >
            创建房间
          </Button>
        </>
      ) : (
        <>
          <TextField
            fullWidth
            label="房间号"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            margin="normal"
          />
          <Button
            fullWidth
            variant="contained"
            onClick={handleJoinRoom}
            disabled={!playerName.trim() || !roomId.trim()}
            sx={{ mt: 2 }}
          >
            加入房间
          </Button>
        </>
      )}
    </Box>
  );
};

export default CreateRoom; 