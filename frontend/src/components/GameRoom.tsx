import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { Socket } from 'socket.io-client';

interface GameRoomProps {
  roomId: string;
  playerName: string;
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

// Use the current window location to determine the backend URL
const backendUrl = window.location.protocol === 'https:' 
  ? `https://${window.location.hostname}:3001`
  : `http://${window.location.hostname}:3001`;

const GameRoom: React.FC<GameRoomProps> = ({ roomId, playerName, socket }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'voting' | 'ended'>('waiting');
  const [honestVoteTarget, setHonestVoteTarget] = useState<string>('');
  const [liarVoteTarget, setLiarVoteTarget] = useState<string>('');
  const [voteResult, setVoteResult] = useState<{
    voterId: string;
    honestTargetId: string;
    liarTargetId?: string;
    isHonestCorrect: boolean;
    isLiarCorrect?: boolean;
    pointsEarned: number;
    smartPlayerScore: number;
    honestPlayerScore?: number;
    gameWinner?: Player;
    isGameOver: boolean;
  } | null>(null);
  const [answerReveal, setAnswerReveal] = useState<{ showing: boolean; endTime: number; answer?: string }>({ showing: false, endTime: 0 });
  const [countdown, setCountdown] = useState<number>(0);

  const handleLeaveGame = () => {
    socket.emit('leaveGame', { roomId, playerId: playerName });
    // Clear local storage
    localStorage.removeItem('currentRoomId');
    localStorage.removeItem('currentPlayerName');
    // Redirect to home page
    window.location.href = '/';
  };

  useEffect(() => {
    console.log('GameRoom mounted');
    
    // Join room
    socket.emit('joinRoom', { roomId, playerName });

    socket.on('playerId', (newPlayerId: string) => {
      console.log('Received player ID:', newPlayerId);
    });

    socket.on('playerJoined', (updatedRoom: Room) => {
      console.log('Room updated:', updatedRoom);
      setRoom(updatedRoom);
      setPhase(updatedRoom.status as any);
    });

    socket.on('gameStarted', (data: { room: Room, question: Question }) => {
      console.log('Game started:', data);
      setRoom(data.room);
      setPhase('playing');
    });

    socket.on('nextGameStarted', (data: { room: Room, question: Question }) => {
      console.log('Next game started:', data);
      setRoom(data.room);
      setPhase('playing');
      setVoteResult(null);
      setAnswerReveal({ showing: false, endTime: 0 });
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

    socket.on('voteResult', (result: {
      voterId: string;
      honestTargetId: string;
      liarTargetId?: string;
      isHonestCorrect: boolean;
      isLiarCorrect?: boolean;
      pointsEarned: number;
      smartPlayerScore: number;
    }) => {
      setVoteResult(result);
      setPhase('ended');
    });

    socket.on('answerReveal', (data: { showing: boolean; endTime: number; answer?: string }) => {
      setAnswerReveal(data);
      if (data.showing && data.endTime) {
        const updateCountdown = () => {
          const left = Math.max(0, Math.floor((data.endTime - Date.now()) / 1000));
          setCountdown(left);
          if (left > 0) {
            setTimeout(updateCountdown, 200);
          }
        };
        updateCountdown();
      } else {
        setCountdown(0);
      }
    });

    // Handle reconnection
    socket.on('connect', () => {
      console.log('Socket reconnected');
      socket.emit('joinRoom', { roomId, playerName });
    });

    socket.on('error', (error: string) => {
      console.error('Socket error:', error);
    });

    return () => {
      // Clean up event listeners
      socket.off('playerId');
      socket.off('playerJoined');
      socket.off('gameStarted');
      socket.off('showAnswer');
      socket.off('votingStarted');
      socket.off('voteResult');
      socket.off('answerReveal');
      socket.off('connect');
      socket.off('error');
    };
  }, [socket, roomId, playerName]);

  const handleStartGame = () => {
    if (room && room.players.length >= 3) {
      socket.emit('startGame', roomId);
    }
  };

  const handleUseHonestButton = () => {
    socket.emit('useHonestButton', roomId);
  };

  const handleVote = () => {
    if (honestVoteTarget) {
      socket.emit('vote', { 
        roomId, 
        honestTargetId: honestVoteTarget,
        liarTargetId: liarVoteTarget || undefined
      });
    }
  };

  const handleNextGame = () => {
    socket.emit('nextGame', roomId);
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

  const me = room.players.find(p => p.name === playerName);
  const isSmart = me?.role === 'smart';
  const honestPlayer = room.players.find(p => p.role === 'honest');
  const canStartVoting = phase === 'playing' && !answerReveal.showing && honestPlayer?.hasUsedHonestButton;
  const isRoomCreator = me?.id === room.players[0]?.id;

  // 你的身份
  let myRoleLabel = '';
  if (me) {
    if (me.role === 'smart') {
      myRoleLabel = '你是大聪明';
    } else if (me.role === 'honest') {
      myRoleLabel = '你是老实人';
    } else {
      myRoleLabel = '你是瞎掰人';
    }
  }
  // 本轮大聪明
  const smartPlayer = room.players.find(p => p.role === 'smart');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">
          房间号: {roomId}
        </Typography>
        <Box>
          {isRoomCreator && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleNextGame}
              sx={{ mr: 2 }}
            >
              开始下一局
            </Button>
          )}
          <Button 
            variant="outlined" 
            color="error" 
            onClick={handleLeaveGame}
          >
            离开游戏
          </Button>
        </Box>
      </Box>
      <Typography variant="h6" color="primary" gutterBottom>
        {myRoleLabel}
      </Typography>
      {smartPlayer && (
        <Typography color="secondary" gutterBottom>
          本轮大聪明：{smartPlayer.name}
        </Typography>
      )}
      {phase === 'waiting' && (
        <Box>
          <Typography variant="h6" gutterBottom>
            等待玩家加入 ({room.players.length}/{room.maxPlayers})
          </Typography>
          {isRoomCreator && (
            <Button
              variant="contained"
              onClick={handleStartGame}
              disabled={room.players.length < 3}
              sx={{ mt: 2 }}
            >
              开始游戏
            </Button>
          )}
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6">玩家列表：</Typography>
            {room.players.map(player => (
              <Typography key={player.id}>
                {player.name} {player.id === playerName && '（你）'} {player.id === room.players[0]?.id && '（房主）'}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      {phase === 'playing' && room.currentQuestion && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6">当前题目：</Typography>
            {room.currentQuestion.content.endsWith('.png') ? (
              <img
                src={backendUrl + room.currentQuestion.content}
                alt="题目图片"
                style={{ maxWidth: '100%', maxHeight: 300, display: 'block', margin: '16px auto' }}
              />
            ) : (
              <Typography>{room.currentQuestion.content}</Typography>
            )}
          </Paper>
          {((phase === 'playing' || phase === 'voting') && answerReveal.showing) && (
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.light' }}>
              {answerReveal.answer ? (
                <>
                  <Typography>答案：</Typography>
                  <img
                    src={backendUrl + answerReveal.answer}
                    alt="答案图片"
                    style={{ maxWidth: '100%', maxHeight: 300, display: 'block', margin: '16px auto' }}
                  />
                  <Typography color="secondary">倒计时：{countdown} 秒</Typography>
                </>
              ) : (
                <Typography color="secondary">老实人查看答案中，倒计时：{countdown} 秒</Typography>
              )}
            </Paper>
          )}
          {me && me.role === 'honest' && phase === 'playing' && !answerReveal.showing && (
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
            {phase === 'playing' && isSmart && (
              <Button variant="contained" color="secondary" onClick={handleVote} sx={{ mt: 2 }} disabled={!canStartVoting}>
                进入投票环节
              </Button>
            )}
          </Box>
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6">玩家列表：</Typography>
            {room.players.map(player => (
              <Typography key={player.id}>
                {player.name} - 分数：{player.score} {player.id === playerName && '（你）'}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      {phase === 'voting' && (
        <Box>
          {isSmart ? (
            <>
              <Typography variant="h6" gutterBottom>请选择你认为的老实人：</Typography>
              {room.players.filter(p => p.role !== 'smart').map(player => (
                <Button
                  key={player.id}
                  variant={honestVoteTarget === player.id ? 'contained' : 'outlined'}
                  onClick={() => setHonestVoteTarget(player.id)}
                  sx={{ m: 1 }}
                >
                  {player.name}
                </Button>
              ))}
              
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>请选择你认为的瞎掰人（可选）：</Typography>
              {room.players.filter(p => p.role !== 'smart' && p.id !== honestVoteTarget).map(player => (
                <Button
                  key={player.id}
                  variant={liarVoteTarget === player.id ? 'contained' : 'outlined'}
                  onClick={() => setLiarVoteTarget(player.id)}
                  sx={{ m: 1 }}
                >
                  {player.name}
                </Button>
              ))}
              
              <Button
                variant="contained"
                color="primary"
                onClick={handleVote}
                disabled={!honestVoteTarget}
                sx={{ mt: 2, display: 'block' }}
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
            大聪明（{room.players.find(p => p.id === voteResult.voterId)?.name}）认为：
          </Typography>
          <Typography>
            老实人是 {room.players.find(p => p.id === voteResult.honestTargetId)?.name}
            {voteResult.isHonestCorrect ? ' ✅' : ' ❌'}
          </Typography>
          {voteResult.liarTargetId && (
            <Typography>
              瞎掰人是 {room.players.find(p => p.id === voteResult.liarTargetId)?.name}
              {voteResult.isLiarCorrect ? ' ✅' : ' ❌'}
            </Typography>
          )}
          <Typography sx={{ mt: 1 }} color="primary">
            本轮得分：
          </Typography>
          <Typography>
            大聪明：{voteResult.pointsEarned} 分
          </Typography>
          {!voteResult.isHonestCorrect && (
            <>
              <Typography>
                老实人：3 分（成功隐藏身份）
              </Typography>
              <Typography>
                瞎掰人：1 分（成功误导）
              </Typography>
            </>
          )}
          
          {voteResult.isGameOver && voteResult.gameWinner && (
            <Paper sx={{ mt: 3, p: 2, bgcolor: 'success.light' }}>
              <Typography variant="h5" gutterBottom>
                🎉 游戏结束！
              </Typography>
              <Typography variant="h6" gutterBottom>
                获胜者：{voteResult.gameWinner.name}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                最终得分：{voteResult.gameWinner.score} 分
              </Typography>
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                所有玩家得分：
              </Typography>
              {room.players
                .sort((a, b) => b.score - a.score)
                .map(player => (
                  <Typography key={player.id}>
                    {player.name}: {player.score} 分
                    {player.id === voteResult.gameWinner.id && ' 👑'}
                  </Typography>
                ))
              }
            </Paper>
          )}
        </Box>
      )}
    </Box>
  );
};

export default GameRoom; 