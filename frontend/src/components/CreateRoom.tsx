import React, { useState, useEffect } from 'react';
import { Box, TextField, Button, Typography, Tabs, Tab, Alert, Accordion, AccordionSummary, AccordionDetails, Slider, List, ListItem, ListItemText, ListItemSecondaryAction, Paper, Chip, IconButton, Tooltip, Avatar, Stack } from '@mui/material';
import { io, Socket } from 'socket.io-client';
import { PeopleAlt } from '@mui/icons-material';
import {  FormControlLabel, Switch } from '@mui/material';

interface CreateRoomProps {
  onRoomCreated: (roomId: string, playerName: string, socket: Socket) => void;
}

// Auto-detect server URL based on current protocol
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  // When using Nginx SSL proxy, we don't need different ports
  return `${protocol}//${hostname}`;
};

const serverUrl = 'http://localhost:3001';
console.log('Using server URL:', serverUrl);

interface RoomInfo {
  id: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'ended' | 'completed';
  totalRounds: number;
  pointsToWin: number;
  answerViewTime: number;
  players: {
    name: string;
    score: number;
    isCreator: boolean;
  }[];
}

// Helper function to generate consistent colors from names
const stringToColor = (string: string) => {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

const CreateRoom: React.FC<CreateRoomProps> = ({ onRoomCreated }) => {
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [totalRounds, setTotalRounds] = useState(3);
  const [pointsToWin, setPointsToWin] = useState(15);
  const [answerViewTime, setAnswerViewTime] = useState(30);
  const [roomId, setRoomId] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomInfo[]>([]);
  const [autoNext, setAutoNext] = useState(true);

  // Check for existing room on component mount and auto-reconnect
  useEffect(() => {
    const savedRoomId = localStorage.getItem('currentRoomId');
    const savedPlayerName = localStorage.getItem('currentPlayerName');
    if (savedRoomId && savedPlayerName) {
      setRoomId(savedRoomId);
      setPlayerName(savedPlayerName);
      setActiveTab(1); // Switch to join room tab
    }

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  // Initialize socket connection when component mounts
  useEffect(() => { 
    const newSocket = io(serverUrl, {
      transports: ['polling'],
      withCredentials: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      timeout: 10000,         // 减少连接超时
      forceNew: true,
      autoConnect: true
    });

    setSocket(newSocket);

    // Set up socket event listeners
    newSocket.on('connect', () => {
      console.log('Socket connected');
      if (activeTab === 1) {
        console.log('Requesting room list after connection');
        newSocket.emit('getRooms');
      }
    });

    newSocket.on('roomList', (rooms: RoomInfo[]) => {
      console.log('Received room list:', rooms);
      setAvailableRooms(rooms);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setError('连接服务器失败，请稍后重试');
    });

    // Clean up on unmount
    return () => {
      console.log('Cleaning up socket connection');
      newSocket.off('connect');
      newSocket.off('roomList');
      newSocket.off('connect_error');
      newSocket.disconnect();
    };
  }, []); // Only run on mount

  const connectToRoom = (roomId: string, playerName: string, isNewRoom: boolean = false) => {
    setIsConnecting(true);
    setError(null);

    // Clean up any existing socket connection
    if (socket) {
      socket.off('roomCreated');
      socket.off('playerJoined');
      socket.off('error');
    }
 
    const newSocket = io(serverUrl, {
      transports: ['polling'],
      withCredentials: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      timeout: 10000,         // 减少连接超时
      forceNew: true,
      autoConnect: true
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected, proceeding with room action');
      if (isNewRoom) {
        console.log('Creating new room with settings:', { maxPlayers, totalRounds, pointsToWin, answerViewTime });
        newSocket.emit('createRoom', { maxPlayers, totalRounds, pointsToWin, answerViewTime, autoNext });
      } else {
        console.log('Joining existing room:', roomId);
        newSocket.emit('joinRoom', { roomId, playerName });
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setError('连接服务器失败，请稍后重试');
      setIsConnecting(false);
    });

    newSocket.on('roomCreated', (data) => {
      console.log('Room created, joining room:', data);
      newSocket.emit('joinRoom', { roomId: data.id, playerName });
    });

    newSocket.on('playerJoined', (room) => {
      console.log('Successfully joined room:', room);
      localStorage.setItem('currentRoomId', room.id);
      localStorage.setItem('currentPlayerName', playerName);
      setIsConnecting(false);
      onRoomCreated(room.id, playerName, newSocket);
    });

    newSocket.on('error', (errorMessage: string) => {
      console.error('Server error:', errorMessage);
      setError(errorMessage);
      setIsConnecting(false);
    });

    // Connect to the server
    newSocket.connect();
  };

  // Request room list when switching to join tab
  useEffect(() => {
    if (socket?.connected && activeTab === 1) {
      console.log('Requesting room list on tab change');
      socket.emit('getRooms');
    }
  }, [activeTab, socket?.connected]);

  // Add auto-refresh for room list with more frequent updates
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (socket?.connected && activeTab === 1) {
      // More frequent refresh for better real-time updates
      intervalId = setInterval(() => {
        console.log('Auto-refreshing room list');
        socket.emit('getRooms');
      }, 2000); // Reduced from 5 seconds to 2 seconds
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [activeTab, socket?.connected]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setError(null);
    if (newValue === 1 && socket?.connected) {
      console.log('Requesting room list on tab change');
      socket.emit('getRooms');
    }
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setError('请输入你的名字');
      return;
    }
    console.log('Creating new room...');
    connectToRoom('', playerName, true);
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('请输入你的名字');
      return;
    }
    if (!roomId.trim()) {
      setError('请选择或输入房间号');
      return;
    }
    console.log('Joining room:', roomId);
    connectToRoom(roomId, playerName, false);
  };

  // Add this function to get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'waiting':
        return 'success';
      case 'playing':
        return 'warning';
      case 'ended':
      case 'completed':
        return 'error';
      default:
        return 'default';
    }
  };

  // Add this function to get status text
  const getStatusText = (status: string) => {
    switch (status) {
      case 'waiting':
        return '等待中';
      case 'playing':
        return '游戏中';
      case 'ended':
        return '已结束';
      case 'completed':
        return '已完成';
      default:
        return status;
    }
  };

  // Modify the join room section to include room list
  const renderJoinRoom = () => (
    <>
      <Typography variant="h6" gutterBottom>
        可用房间
      </Typography>
      {availableRooms.length === 0 ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', my: 2 }}>
          暂无可用房间
        </Typography>
      ) : (
        <List sx={{ width: '100%', bgcolor: 'background.paper', mb: 2 }}>
          {availableRooms.map((room) => (
            <Paper 
              key={room.id} 
              sx={{ 
                mb: 1, 
                p: 1,
                cursor: 'pointer',
                bgcolor: roomId === room.id ? 'action.selected' : 'background.paper',
                '&:hover': {
                  bgcolor: 'action.hover'
                }
              }}
              onClick={() => setRoomId(room.id)}
            >
              <ListItem>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle1">
                        房间号: {room.id}
                      </Typography>
                      <Chip
                        size="small"
                        label={getStatusText(room.status)}
                        color={getStatusColor(room.status) as any}
                      />
                    </Box>
                  }
                  secondary={
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" component="div">
                        玩家: {room.playerCount}/{room.maxPlayers}
                      </Typography>
                      <Typography variant="body2" component="div">
                        设置: {room.totalRounds}局 | {room.pointsToWin}分胜利 | {room.answerViewTime}秒查看
                      </Typography>
                      <Typography variant="body2" component="div">
                        玩家列表:
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                        {room.players.map(p => (
                          <Chip
                            key={p.name}
                            avatar={<Avatar sx={{ bgcolor: stringToColor(p.name) }}>{p.name.charAt(0).toUpperCase()}</Avatar>}
                            label={p.name}
                            variant={p.isCreator ? "filled" : "outlined"}
                            color={p.isCreator ? "primary" : "default"}
                            size="small"
                            sx={{ mb: 0.5 }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  }
                />
              </ListItem>
            </Paper>
          ))}
        </List>
      )}
      <TextField
        fullWidth
        label="你的名字"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        margin="normal"
        error={!playerName.trim() && isConnecting}
        helperText={!playerName.trim() && isConnecting ? '请输入你的名字' : ''}
      />
      <Button
        fullWidth
        variant="contained"
        onClick={handleJoinRoom}
        disabled={!playerName.trim() || !roomId.trim() || isConnecting}
        sx={{ mt: 2 }}
      >
        {isConnecting ? '加入中...' : '加入房间'}
      </Button>
    </>
  );

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', p: 3 }}>
      <Tabs value={activeTab} onChange={handleTabChange} centered sx={{ mb: 3 }}>
        <Tab label="创建房间" />
        <Tab label="加入房间" />
      </Tabs>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {activeTab === 0 ? (
        <>
          <TextField
            fullWidth
            label="你的名字"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            margin="normal"
            error={!playerName.trim() && isConnecting}
            helperText={!playerName.trim() && isConnecting ? '请输入你的名字' : ''}
          />
          <Accordion defaultExpanded={false}>
            <AccordionSummary
              expandIcon={<Typography>▼</Typography>}
              aria-controls="game-settings-content"
              id="game-settings-header"
            >
              <Typography>游戏设置</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ mt: 1 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography gutterBottom>最大玩家数 (3-10)</Typography>
                  <Slider
                    value={maxPlayers}
                    onChange={(_, value) => setMaxPlayers(value as number)}
                    min={3}
                    max={10}
                    marks
                    step={1}
                    valueLabelDisplay="auto"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography gutterBottom>游戏局数 (1-10)</Typography>
                  <Slider
                    value={totalRounds}
                    onChange={(_, value) => setTotalRounds(value as number)}
                    min={1}
                    max={10}
                    marks
                    step={1}
                    valueLabelDisplay="auto"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography gutterBottom>获胜所需分数 (5-30)</Typography>
                  <Slider
                    value={pointsToWin}
                    onChange={(_, value) => setPointsToWin(value as number)}
                    min={5}
                    max={30}
                    marks
                    step={5}
                    valueLabelDisplay="auto"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography gutterBottom>答案显示时间 (秒) (10-60)</Typography>
                  <Slider
                    value={answerViewTime}
                    onChange={(_, value) => setAnswerViewTime(value as number)}
                    min={10}
                    max={60}
                    marks
                    step={5}
                    valueLabelDisplay="auto"
                  />
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoNext}
                      onChange={(e) => setAutoNext(e.target.checked)}
                    />
                  }
                  label="投票后自动切换下一题"
                  sx={{ mt: 2, display: 'block' }}
                />
              </Box>
            </AccordionDetails>
          </Accordion>
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
        renderJoinRoom()
      )}
    </Box>
  );
};

export default CreateRoom; 