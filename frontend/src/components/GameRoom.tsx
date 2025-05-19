import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { Socket } from 'socket.io-client';

interface GameRoomProps {
  roomId: string;
  playerName: string;
  playerId: string;
  socket: Socket;
}

interface Question {
  id: string;
  content: string;
  answer: string;
}

interface Player {
  id: string;
  name: string;
  role: 'smart' | 'honest' | 'liar';
  score: number;
  hasUsedHonestButton: boolean;
}

interface Room {
  id: string;
  players: Player[];
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'ended';
  currentQuestion?: Question;
  round: number;
}

const GameRoom: React.FC<GameRoomProps> = ({ roomId, playerName, playerId, socket }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    socket.on('playerJoined', (updatedRoom: Room) => {
      setRoom(updatedRoom);
    });
    socket.on('gameStarted', (data: { room: Room, question: Question }) => {
      setRoom(data.room);
    });
    socket.on('showAnswer', (answer: string) => {
      setAnswer(answer);
      setShowAnswer(true);
      setTimeout(() => setShowAnswer(false), 30000);
    });
    return () => {
      // 不再断开socket
    };
  }, [socket]);

  const handleStartGame = () => {
    socket.emit('startGame', roomId);
  };

  const handleUseHonestButton = () => {
    socket.emit('useHonestButton', roomId);
  };

  if (!room) {
    return (
      <Box>
        <Typography variant="h5" gutterBottom>
          房间号: {roomId}
        </Typography>
        <Typography>加载中...</Typography>
      </Box>
    );
  }

  const me = room.players.find(p => p.id === playerId);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        房间号: {roomId}
      </Typography>
      {room.status === 'waiting' && (
        <Box>
          <Typography variant="h6" gutterBottom>
            等待玩家加入 ({room.players.length}/{room.maxPlayers})
          </Typography>
          <Button
            variant="contained"
            onClick={handleStartGame}
            disabled={room.players.length < 3}
          >
            开始游戏
          </Button>
        </Box>
      )}
      {room.status === 'playing' && room.currentQuestion && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6">当前题目：</Typography>
            <Typography>{room.currentQuestion.content}</Typography>
          </Paper>
          {me && me.role === 'honest' && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleUseHonestButton}
              disabled={me.hasUsedHonestButton}
            >
              查看答案（老实人专属）
            </Button>
          )}
          {showAnswer && (
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.light' }}>
              <Typography>答案：{answer}</Typography>
            </Paper>
          )}
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6">玩家列表：</Typography>
            {room.players.map(player => (
              <Typography key={player.id}>
                {player.name} - {player.role} - {player.id}
                {player.id === playerId && '（你）'}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default GameRoom; 