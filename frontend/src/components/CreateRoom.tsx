import React, { useState, useEffect } from 'react';
import { Box, TextField, Button, Typography, Tabs, Tab, Alert } from '@mui/material';
import { io, Socket } from 'socket.io-client';

interface CreateRoomProps {
  onRoomCreated: (roomId: string, playerName: string, socket: Socket) => void;
}

const CreateRoom: React.FC<CreateRoomProps> = ({ onRoomCreated }) => {
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [roomId, setRoomId] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Check for existing room on component mount
  useEffect(() => {
    const savedRoomId = localStorage.getItem('currentRoomId');
    const savedPlayerName = localStorage.getItem('currentPlayerName');
    if (savedRoomId && savedPlayerName) {
      setRoomId(savedRoomId);
      setPlayerName(savedPlayerName);
      setActiveTab(1); // Switch to join room tab
    }
  }, []);

  const connectToRoom = (roomId: string, playerName: string, isNewRoom: boolean = false) => {
    setIsConnecting(true);
    setError(null);

    const socket = io('http://8.148.30.163:3001', {
      transports: ['polling'],
      withCredentials: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      forceNew: true,
      autoConnect: true
    });

    // Set up all event listeners before connecting
    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setError('连接服务器失败，请稍后重试');
      setIsConnecting(false);
      socket.disconnect();
    });

    socket.on('connect', () => {
      console.log('Connected to server');
      if (isNewRoom) {
        console.log('Creating new room...');
        socket.emit('createRoom', maxPlayers);
      } else {
        console.log('Joining existing room...');
        socket.emit('joinRoom', { roomId, playerName });
      }
    });

    socket.on('roomCreated', (data) => {
      console.log('Room created:', data);
      socket.emit('joinRoom', { roomId: data.id, playerName });
    });

    socket.on('playerJoined', (room) => {
      console.log('Player joined:', room);
      localStorage.setItem('currentRoomId', room.id);
      localStorage.setItem('currentPlayerName', playerName);
      setIsConnecting(false);
      onRoomCreated(room.id, playerName, socket);
    });

    socket.on('error', (errorMessage: string) => {
      console.error('Server error:', errorMessage);
      setError(errorMessage);
      setIsConnecting(false);
      socket.disconnect();
    });

    // Connect to the server
    socket.connect();
  };

  const handleCreateRoom = () => {
    if (playerName.trim()) {
      connectToRoom('', playerName, true);
    }
  };

  const handleJoinRoom = () => {
    if (playerName.trim() && roomId.trim()) {
      connectToRoom(roomId, playerName);
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
            disabled={!playerName.trim() || isConnecting}
            sx={{ mt: 2 }}
          >
            {isConnecting ? '连接中...' : '创建房间'}
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
            disabled={!playerName.trim() || !roomId.trim() || isConnecting}
            sx={{ mt: 2 }}
          >
            {isConnecting ? '连接中...' : '加入房间'}
          </Button>
        </>
      )}
    </Box>
  );
};

export default CreateRoom; 