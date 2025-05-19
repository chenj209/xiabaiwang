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
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'voting' | 'ended'>('waiting');
  const [voteTarget, setVoteTarget] = useState<string>('');
  const [voteResult, setVoteResult] = useState<{ voterId: string; targetId: string } | null>(null);

  useEffect(() => {
    socket.on('playerJoined', (updatedRoom: Room) => {
      setRoom(updatedRoom);
      setPhase(updatedRoom.status as any);
    });
    socket.on('gameStarted', (data: { room: Room, question: Question }) => {
      setRoom(data.room);
      setPhase('playing');
    });
    socket.on('showAnswer', (answer: string) => {
      setAnswer(answer);
      setShowAnswer(true);
      setTimeout(() => setShowAnswer(false), 30000);
    });
    socket.on('votingStarted', ({ room }) => {
      setRoom(room);
      setPhase('voting');
    });
    socket.on('voteResult', (result: { voterId: string; targetId: string }) => {
      setVoteResult(result);
      setPhase('ended');
    });
    return () => {
      // 不断开socket
    };
  }, [socket]);

  const handleStartGame = () => {
    socket.emit('startGame', roomId);
  };

  const handleUseHonestButton = () => {
    socket.emit('useHonestButton', roomId);
  };

  const handleStartVoting = () => {
    socket.emit('startVoting', roomId);
  };

  const handleVote = () => {
    if (voteTarget) {
      socket.emit('vote', { roomId, targetId: voteTarget });
    }
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
  const isSmart = me?.role === 'smart';

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        房间号: {roomId}
      </Typography>
      {phase === 'waiting' && (
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
      {phase === 'playing' && room.currentQuestion && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6">当前题目：</Typography>
            <Typography>{room.currentQuestion.content}</Typography>
          </Paper>
          {((phase === 'playing' || phase === 'voting') && showAnswer) && (
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.light' }}>
              <Typography>答案：{answer}</Typography>
            </Paper>
          )}
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
          <Box sx={{ mt: 2 }}>
            {isSmart && (
              <Button variant="contained" color="secondary" onClick={handleStartVoting} sx={{ mt: 2 }}>
                进入投票环节
              </Button>
            )}
          </Box>
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
      {phase === 'voting' && (
        <Box>
          {isSmart ? (
            <>
              <Typography variant="h6">请选择你认为的老实人：</Typography>
              {room.players.filter(p => p.role !== 'smart').map(player => (
                <Button
                  key={player.id}
                  variant={voteTarget === player.id ? 'contained' : 'outlined'}
                  onClick={() => setVoteTarget(player.id)}
                  sx={{ m: 1 }}
                >
                  {player.name}
                </Button>
              ))}
              <Button
                variant="contained"
                color="primary"
                onClick={handleVote}
                disabled={!voteTarget}
                sx={{ ml: 2 }}
              >
                投票
              </Button>
            </>
          ) : (
            <Typography>等待大聪明投票...</Typography>
          )}
        </Box>
      )}
      {phase === 'ended' && voteResult && (
        <Box>
          <Typography variant="h6">投票结果：</Typography>
          <Typography>
            大聪明（{room.players.find(p => p.id === voteResult.voterId)?.name}）投票给了 {room.players.find(p => p.id === voteResult.targetId)?.name}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default GameRoom; 