import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Button, Paper, ButtonGroup, Tooltip, Divider, CircularProgress, Avatar, Chip } from '@mui/material';
import { Socket } from 'socket.io-client';
import { PeopleAlt, PlayArrow, Mic } from '@mui/icons-material';
import VoiceChat from './VoiceChat';

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
  status: 'waiting' | 'playing' | 'voting' | 'ended' | 'completed';
  currentQuestion?: Question;
  round: number;
  totalRounds: number;
  pointsToWin: number;
  answerViewTime: number;
  voteResult?: {
    voterId: string;
    honestTargetId: string;
    liarTargetId?: string;
  };
  answerReveal?: { showing: boolean; endTime: number };
  gameWinner?: Player;
  currentSmartIndex: number;
}

// Use the current window location to determine the backend URL
const backendUrl = `${window.location.protocol}//${window.location.hostname}`;

// Add this type definition at the top of the file after the imports
type GamePhase = 'waiting' | 'playing' | 'voting' | 'ended' | 'completed';

// Add answer display component
const AnswerDisplay: React.FC<{
  showing: boolean;
  answer?: string;
  countdown: number;
  backendUrl: string;
}> = React.memo(({ showing, answer, countdown, backendUrl }) => {
  if (!showing) return null;
  
  return (
    <Box sx={{ mt: 2, textAlign: 'center' }}>
      <Typography variant="h6" color="primary">
        {countdown > 0 ? `答案显示倒计时: ${countdown}秒` : '时间到！'}
      </Typography>
      {answer && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6">答案：</Typography>
          {answer.endsWith('.png') ? (
            <img
              src={backendUrl + answer}
              alt="答案图片"
              style={{ maxWidth: '100%', maxHeight: 300, display: 'block', margin: '16px auto' }}
              loading="lazy"
            />
          ) : (
            <Typography>{answer}</Typography>
          )}
        </Paper>
      )}
    </Box>
  );
});

// Honest button component
const HonestButton: React.FC<{
  me: Player | undefined;
  phase: GamePhase;
  answerRevealShowing: boolean;
  onUseHonestButton: () => void;
}> = React.memo(({ me, phase, answerRevealShowing, onUseHonestButton }) => {
  const shouldShow = me && 
    me.role === 'honest' && 
    phase === 'playing' && 
    !answerRevealShowing;

  if (!shouldShow) return null;

  return (
    <Button
      variant="contained"
      color="primary"
      onClick={onUseHonestButton}
      disabled={me.hasUsedHonestButton}
      sx={{ mt: 2, mb: 2 }}
    >
      {me.hasUsedHonestButton ? '已查看答案' : '查看答案（老实人专属）'}
    </Button>
  );
});

// Add VoteSection component
const VoteSection: React.FC<{
  players: Player[];
  smartPlayerId: string;
  honestVoteTarget: string;
  liarVoteTarget: string;
  onHonestVoteSelect: (playerId: string) => void;
  onLiarVoteSelect: (playerId: string) => void;
  onVoteSubmit: () => void;
}> = React.memo(({ 
  players, 
  smartPlayerId, 
  honestVoteTarget, 
  liarVoteTarget,
  onHonestVoteSelect,
  onLiarVoteSelect,
  onVoteSubmit 
}) => {
  const nonSmartPlayers = players.filter(p => p.id !== smartPlayerId);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>请选择你认为的老实人：</Typography>
      <ButtonGroup variant="contained" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {nonSmartPlayers.map(player => (
          <Tooltip 
            key={player.id} 
            title={liarVoteTarget === player.id ? "此玩家已被选为瞎掰人" : ""}
          >
            <span>
              <Button
                variant={honestVoteTarget === player.id ? 'contained' : 'outlined'}
                onClick={() => onHonestVoteSelect(honestVoteTarget === player.id ? '' : player.id)}
                disabled={liarVoteTarget === player.id}
                color={honestVoteTarget === player.id ? 'primary' : 'inherit'}
                sx={{ m: 1 }}
              >
                {player.name}
              </Button>
            </span>
          </Tooltip>
        ))}
      </ButtonGroup>
      
      <Typography variant="h6" gutterBottom>请选择你认为的瞎掰人（可选）：</Typography>
      <ButtonGroup variant="contained" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {nonSmartPlayers.map(player => (
          <Tooltip 
            key={player.id} 
            title={honestVoteTarget === player.id ? "此玩家已被选为老实人" : ""}
          >
            <span>
              <Button
                variant={liarVoteTarget === player.id ? 'contained' : 'outlined'}
                onClick={() => onLiarVoteSelect(liarVoteTarget === player.id ? '' : player.id)}
                disabled={honestVoteTarget === player.id}
                color={liarVoteTarget === player.id ? 'secondary' : 'inherit'}
                sx={{ m: 1 }}
              >
                {player.name}
              </Button>
            </span>
          </Tooltip>
        ))}
      </ButtonGroup>
      
      <Button
        variant="contained"
        color="primary"
        onClick={onVoteSubmit}
        disabled={!honestVoteTarget}
        sx={{ mt: 2, display: 'block' }}
      >
        投票
      </Button>
    </Box>
  );
});

// Add ChatSection component
const ChatSection: React.FC<{
  messages: Array<{
    id: string;
    sender: string;
    content: string;
    type: 'text' | 'emoji';
    timestamp: number;
  }>;
  onSendMessage: (content: string, type: 'text' | 'emoji') => void;
}> = React.memo(({ messages, onSendMessage }) => {
  const [inputMessage, setInputMessage] = useState('');
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  // Common emojis with categories
  const emojiCategories = {
    faces: ['😊', '😂', '🤔', '😅', '😄', '🥰', '😎', '🤗'],
    gestures: ['👍', '👋', '🤝', '👏', '🙌', '✌️', '🤞', '👌'],
    games: ['🎮', '🎲', '🎯', '🎪', '🎨', '🎭', '🎪', '🎰'],
    symbols: ['❤️', '💡', '⭐', '✨', '💫', '🔥', '💯', '🎉']
  };

  const [activeCategory, setActiveCategory] = useState<keyof typeof emojiCategories>('faces');

  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      const element = messagesContainerRef.current;
      const isScrolledToBottom = element.scrollHeight - element.clientHeight <= element.scrollTop + 100;
      
      if (isScrolledToBottom) {
        setTimeout(() => {
          element.scrollTop = element.scrollHeight;
        }, 100);
      }
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isSending) return;

    try {
      setIsSending(true);
      setError(null);
      await onSendMessage(inputMessage.trim(), 'text');
      setInputMessage('');
      scrollToBottom();
    } catch (err) {
      setError('发送消息失败，请重试');
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleEmojiClick = useCallback((emoji: string) => {
    if (inputRef.current) {
      const start = inputRef.current.selectionStart || 0;
      const end = inputRef.current.selectionEnd || 0;
      const newMessage = inputMessage.substring(0, start) + emoji + inputMessage.substring(end);
      setInputMessage(newMessage);
      
      const newPosition = start + emoji.length;
      setCursorPosition(newPosition);
      
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newPosition, newPosition);
        }
      });
    }
  }, [inputMessage]);

  return (
    <Paper 
      sx={{ 
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 100px)',
        minHeight: '500px'
      }}
    >
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6">聊天室</Typography>
      </Box>
      
      <Box 
        ref={messagesContainerRef}
        sx={{ 
          flex: 1, 
          overflowY: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          bgcolor: 'background.default',
          minHeight: '300px'
        }}
      >
        {messages.map(msg => (
          <Box 
            key={msg.id}
            sx={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              maxWidth: '100%'
            }}
          >
            <Typography 
              variant="caption" 
              color="text.secondary"
              sx={{ mb: 0.5 }}
            >
              {msg.sender} • {new Date(msg.timestamp).toLocaleTimeString()}
            </Typography>
            <Paper
              elevation={1}
              sx={{ 
                p: 1.5,
                bgcolor: 'action.hover',
                maxWidth: '85%',
                wordBreak: 'break-word'
              }}
            >
              <Typography 
                sx={{ 
                  fontSize: '0.9rem',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {msg.content}
              </Typography>
            </Paper>
          </Box>
        ))}
      </Box>

      {/* Emoji Categories */}
      <Box sx={{ 
        p: 1, 
        borderTop: 1, 
        borderColor: 'divider',
        display: 'flex',
        gap: 1,
        bgcolor: 'background.paper'
      }}>
        {Object.keys(emojiCategories).map((category) => (
          <Button
            key={category}
            size="small"
            variant={activeCategory === category ? "contained" : "outlined"}
            onClick={() => setActiveCategory(category as keyof typeof emojiCategories)}
            sx={{ minWidth: 'auto', px: 1 }}
          >
            {category === 'faces' ? '😊' : 
             category === 'gestures' ? '👍' : 
             category === 'games' ? '🎮' : '❤️'}
          </Button>
        ))}
      </Box>

      {/* Emoji Selector */}
      <Box sx={{ 
        p: 1.5, 
        borderTop: 1, 
        borderColor: 'divider',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        bgcolor: 'background.paper'
      }}>
        {emojiCategories[activeCategory].map(emoji => (
          <Button
            key={emoji}
            variant="text"
            onClick={() => handleEmojiClick(emoji)}
            sx={{ 
              minWidth: 'auto',
              p: 1,
              fontSize: '1.5rem',
              borderRadius: 1,
              '&:hover': {
                bgcolor: 'action.hover'
              }
            }}
          >
            {emoji}
          </Button>
        ))}
      </Box>

      {/* Error Message */}
      {error && (
        <Typography 
          color="error" 
          variant="caption" 
          sx={{ px: 2, py: 1 }}
        >
          {error}
        </Typography>
      )}

      {/* Input Area */}
      <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
        <form 
          onSubmit={handleSendMessage} 
          style={{ 
            display: 'flex', 
            gap: '8px'
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => {
              setInputMessage(e.target.value);
              setError(null);
            }}
            onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart || 0)}
            placeholder={isSending ? "发送中..." : "输入消息..."}
            disabled={isSending}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              outline: 'none',
              fontSize: '14px',
              backgroundColor: isSending ? '#f5f5f5' : 'white'
            }}
            maxLength={100}
          />
          <Button 
            type="submit" 
            variant="contained" 
            disabled={!inputMessage.trim() || isSending}
            size="small"
          >
            {isSending ? '发送中...' : '发送'}
          </Button>
        </form>
      </Box>
    </Paper>
  );
});

const GameRoom: React.FC<GameRoomProps> = ({ roomId, playerName, socket }) => {
  // Add state persistence
  const [room, setRoom] = useState<Room | null>(() => {
    const savedRoom = localStorage.getItem(`room:${roomId}`);
    return savedRoom ? JSON.parse(savedRoom) : null;
  });
  
  const [messages, setMessages] = useState<Array<{
    id: string;
    sender: string;
    content: string;
    type: 'text' | 'emoji';
    timestamp: number;
  }>>(() => {
    const savedMessages = localStorage.getItem(`messages:${roomId}`);
    return savedMessages ? JSON.parse(savedMessages) : [];
  });

  const [phase, setPhase] = useState<GamePhase>(() => {
    const savedPhase = localStorage.getItem(`phase:${roomId}`);
    return (savedPhase as GamePhase) || 'waiting';
  });

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
  } | null>(() => {
    const savedVoteResult = localStorage.getItem(`voteResult:${roomId}`);
    return savedVoteResult ? JSON.parse(savedVoteResult) : null;
  });

  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState('');
  const [honestVoteTarget, setHonestVoteTarget] = useState<string>('');
  const [liarVoteTarget, setLiarVoteTarget] = useState<string>('');
  const [answerReveal, setAnswerReveal] = useState<{ 
    showing: boolean; 
    endTime: number; 
    answer?: string;
    timeInSeconds?: number;
  }>({ showing: false, endTime: 0 });
  const [countdown, setCountdown] = useState<number>(0);
  const [roomClosed, setRoomClosed] = useState<{message: string; shouldRedirect: boolean} | null>(null);
  const [roundTransition, setRoundTransition] = useState<{
    active: boolean;
    countdown: number;
    nextRound: number;
  }>({ active: false, countdown: 5, nextRound: 0 });

  // Add this line to track player ID
  const [playerId, setPlayerId] = useState<string>("");

  // Memoize computed values
  const me = useMemo(() => room?.players.find(p => p.name === playerName), [room, playerName]);
  const isSmart = useMemo(() => me?.role === 'smart', [me]);
  const honestPlayer = useMemo(() => room?.players.find(p => p.role === 'honest'), [room]);
  const canStartVoting = useMemo(
    () => phase === 'playing' && !answerReveal.showing && honestPlayer?.hasUsedHonestButton,
    [phase, answerReveal.showing, honestPlayer]
  );
  const isRoomCreator = useMemo(() => me?.id === room?.players[0]?.id, [me, room]);
  const smartPlayer = useMemo(() => room?.players.find(p => p.role === 'smart'), [room]);

  // Memoize role label
  const myRoleLabel = useMemo(() => {
    if (!me) return '';
    if (me.role === 'smart') return '你是大聪明';
    if (me.role === 'honest') return '你是老实人';
    return '你是瞎掰人';
  }, [me]);

  // Add connection status state
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const maxReconnectAttempts = 5;

  // Add reconnection modal component
  const ReconnectionModal = () => {
    if (!isReconnecting) return null;

    return (
      <Box
        sx={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1500,
          minWidth: 300,
          maxWidth: '90%'
        }}
      >
        <Paper
          elevation={24}
          sx={{
            p: 4,
            textAlign: 'center',
            bgcolor: 'background.paper',
            borderRadius: 2,
            boxShadow: 3
          }}
        >
          <Box sx={{ mb: 3 }}>
            <Box
              sx={{
                display: 'inline-block',
                position: 'relative',
                width: 40,
                height: 40
              }}
            >
              <CircularProgress
                size={40}
                thickness={4}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0
                }}
              />
              <Typography
                variant="body2"
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)'
                }}
              >
                {reconnectAttempts}
              </Typography>
            </Box>
          </Box>
          <Typography variant="h6" gutterBottom>
            正在重新连接...
          </Typography>
          <Typography variant="body2" color="text.secondary">
            尝试次数: {reconnectAttempts}/{maxReconnectAttempts}
          </Typography>
          {reconnectAttempts === maxReconnectAttempts && (
            <Box sx={{ mt: 2 }}>
              <Typography color="error" gutterBottom>
                重连失败
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => {
                  localStorage.removeItem('currentRoomId');
                  localStorage.removeItem('currentPlayerName');
                  window.location.href = '/';
                }}
                sx={{ mt: 1 }}
              >
                返回大厅
              </Button>
            </Box>
          )}
        </Paper>
      </Box>
    );
  };

  // Add backdrop for modal
  const Backdrop = () => {
    if (!isReconnecting) return null;

    return (
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgcolor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1400
        }}
      />
    );
  };

  // Add round transition effect
  useEffect(() => {
    if (roundTransition.active && roundTransition.countdown > 0) {
      const timer = setInterval(() => {
        setRoundTransition(prev => ({
          ...prev,
          countdown: prev.countdown - 1
        }));
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [roundTransition.active, roundTransition.countdown]);

  // Add round transition display
  const RoundTransition = () => {
    if (!roundTransition.active || !room) return null;

    const nextRoundNum = Math.min(roundTransition.nextRound + 1, room.totalRounds);

    return (
      <Paper 
        sx={{ 
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          p: 4,
          textAlign: 'center',
          bgcolor: 'primary.main',
          color: 'white',
          borderRadius: 2,
          boxShadow: 3,
          zIndex: 1000
        }}
      >
        <Typography variant="h4" gutterBottom>
          准备开始第 {nextRoundNum} 局
        </Typography>
        <Typography variant="h2">
          {roundTransition.countdown}
        </Typography>
      </Paper>
    );
  };

  // Add effect to save state changes
  useEffect(() => {
    if (room) {
      localStorage.setItem(`room:${roomId}`, JSON.stringify(room));
    }
  }, [room, roomId]);

  useEffect(() => {
    localStorage.setItem(`messages:${roomId}`, JSON.stringify(messages));
  }, [messages, roomId]);

  useEffect(() => {
    localStorage.setItem(`phase:${roomId}`, phase);
  }, [phase, roomId]);

  useEffect(() => {
    if (voteResult) {
      localStorage.setItem(`voteResult:${roomId}`, JSON.stringify(voteResult));
    }
  }, [voteResult, roomId]);

  // Add cleanup on room closure or game completion
  useEffect(() => {
    const cleanup = () => {
      localStorage.removeItem(`room:${roomId}`);
      localStorage.removeItem(`messages:${roomId}`);
      localStorage.removeItem(`phase:${roomId}`);
      localStorage.removeItem(`voteResult:${roomId}`);
    };

    if (phase === 'completed' || roomClosed) {
      cleanup();
    }

    return () => {
      if (phase === 'completed' || roomClosed) {
        cleanup();
      }
    };
  }, [phase, roomClosed, roomId]);

  // Optimize handlers
  const handleLeaveGame = useCallback(() => {
    socket.emit('leaveGame', { roomId, playerId: playerName });
    localStorage.removeItem('currentRoomId');
    localStorage.removeItem('currentPlayerName');
    window.location.href = '/';
  }, [socket, roomId, playerName]);

  const handleStartGame = useCallback(() => {
    if (room && room.players.length >= 3) {
      socket.emit('startGame', roomId);
    }
  }, [socket, roomId, room]);

  const handleUseHonestButton = useCallback(() => {
    if (!room || !me || me.role !== 'honest' || me.hasUsedHonestButton) {
      console.log('Invalid state for honest button:', {
        room: !!room,
        isHonest: me?.role === 'honest',
        hasUsed: me?.hasUsedHonestButton
      });
      return;
    }
    console.log('Sending useHonestButton event');
    socket.emit('useHonestButton', roomId);
  }, [socket, roomId, room, me]);

  const handleStartVoting = useCallback(() => {
    socket.emit('startVoting', roomId);
  }, [socket, roomId]);

  const handleVote = useCallback(() => {
    if (honestVoteTarget) {
      socket.emit('vote', { 
        roomId, 
        honestTargetId: honestVoteTarget,
        liarTargetId: liarVoteTarget || undefined
      });
    }
  }, [socket, roomId, honestVoteTarget, liarVoteTarget]);

  const handleNextGame = useCallback(() => {
    socket.emit('nextGame', roomId);
  }, [socket, roomId]);

  // Add message handler
  const handleSendMessage = useCallback((content: string, type: 'text' | 'emoji') => {
    if (!room || !playerName) return;
    
    console.log('Sending chat message:', { roomId, content, type, sender: playerName });
    socket.emit('chatMessage', {
      roomId,
      content,
      type,
      sender: playerName
    });
  }, [socket, roomId, playerName, room]);

  // Add vote handlers
  const handleHonestVoteSelect = useCallback((playerId: string) => {
    setHonestVoteTarget(playerId);
  }, []);

  const handleLiarVoteSelect = useCallback((playerId: string) => {
    setLiarVoteTarget(playerId);
  }, []);

  // Update the useEffect to store player ID
  useEffect(() => {
    const handlePlayerJoined = (updatedRoom: Room) => {
      console.log('Room updated:', updatedRoom);
      setRoom(updatedRoom);
      setPhase(updatedRoom.status);

      // Update localStorage
      localStorage.setItem(`room:${roomId}`, JSON.stringify(updatedRoom));
      localStorage.setItem(`phase:${roomId}`, updatedRoom.status);
    };

    const handleGameStarted = (data: { room: Room, question: Question }) => {
      console.log('Game started:', data);
      setRoom(data.room);
      setPhase('playing');
      
      // Update localStorage
      localStorage.setItem(`room:${roomId}`, JSON.stringify(data.room));
      localStorage.setItem(`phase:${roomId}`, 'playing');
    };

    const handleNextGameStarted = (data: { room: Room, question: Question }) => {
      console.log('Next game started:', data);
      setRoom(data.room);
      setPhase('playing');
      setVoteResult(null);
      setAnswerReveal({ showing: false, endTime: 0 });
      
      // Clear chat messages and update localStorage
      setMessages([]);
      localStorage.setItem(`room:${roomId}`, JSON.stringify(data.room));
      localStorage.setItem(`phase:${roomId}`, 'playing');
      localStorage.removeItem(`voteResult:${roomId}`);
      localStorage.setItem(`messages:${roomId}`, '[]');
    };

    const handlePlayerLeft = (data: { playerName: string, playerId: string, room: Room }) => {
      console.log('Player left:', data);
      setRoom(data.room);
      
      // Update localStorage
      localStorage.setItem(`room:${roomId}`, JSON.stringify(data.room));
      
      // Add a chat message about player leaving
      const leaveMessage = {
        id: Math.random().toString(36).substring(7),
        sender: '系统',
        content: `${data.playerName} 离开了房间`,
        type: 'text' as const,
        timestamp: Date.now()
      };
      
      setMessages(prev => [...prev, leaveMessage]);
    };

    const handleRoomClosed = (data: { message: string, shouldRedirect: boolean }) => {
      console.log('Room closed:', data);
      setRoomClosed(data);
      setRoom(null);
      
      if (data.shouldRedirect) {
        setTimeout(() => {
          localStorage.removeItem('currentRoomId');
          localStorage.removeItem('currentPlayerName');
          window.location.href = '/';
        }, 2000);
      }
    };

    const handleAnswerReveal = (data: { 
      showing: boolean; 
      endTime: number; 
      answer?: string;
      timeInSeconds?: number;
    }) => {
      console.log('Answer reveal received:', data);
      setAnswerReveal(data);
      
      if (data.showing && data.timeInSeconds) {
        console.log('Starting countdown from:', data.timeInSeconds);
        setCountdown(data.timeInSeconds);

        // Clear any existing interval
        const intervalId = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 0) {
              clearInterval(intervalId);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        // Cleanup interval
        return () => {
          console.log('Clearing countdown interval');
          clearInterval(intervalId);
        };
      } else {
        setCountdown(0);
      }
    };

    // Add chat message handler
    const handleChatMessage = (message: {
      id: string;
      sender: string;
      content: string;
      type: 'text' | 'emoji';
      timestamp: number;
    }) => {
      console.log('Received chat message:', message);
      setMessages(prev => {
        // Keep only the last 50 messages
        const newMessages = [...prev, message];
        if (newMessages.length > 50) {
          return newMessages.slice(-50);
        }
        return newMessages;
      });
    };

    // Set up event listeners
    socket.emit('joinRoom', { roomId, playerName });
    
    socket.on('playerJoined', handlePlayerJoined);
    socket.on('gameStarted', handleGameStarted);
    socket.on('nextGameStarted', handleNextGameStarted);
    socket.on('playerLeft', handlePlayerLeft);
    socket.on('roomClosed', handleRoomClosed);
    socket.on('playerId', (id: string) => {
      console.log('Got player ID:', id);
      setPlayerId(id);
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
      honestPlayerScore?: number;
      gameWinner?: Player;
      isGameOver: boolean;
    }) => {
      setVoteResult(result);
      setPhase(result.isGameOver ? 'completed' : 'ended');
    });
    socket.on('answerReveal', handleAnswerReveal);
    socket.on('chatMessage', handleChatMessage);

    socket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
      setIsReconnecting(false);
      setReconnectAttempts(0);
      
      // Rejoin room on reconnect
      if (roomId && playerName) {
        console.log(`Rejoining room ${roomId} as ${playerName}`);
        socket.emit('joinRoom', { roomId, playerName });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
      
      // Start reconnection process only for certain disconnect reasons
      if (reason === 'io server disconnect' || reason === 'transport close') {
        console.log('Server disconnected, attempting to reconnect...');
        if (reconnectAttempts < maxReconnectAttempts) {
          setIsReconnecting(true);
          setReconnectAttempts(prev => prev + 1);
          setTimeout(() => {
            if (socket.disconnected) {
              console.log(`Reconnection attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
              socket.connect();
            }
          }, 1000 * Math.min(reconnectAttempts + 1, 5)); // Exponential backoff, max 5 seconds
        } else {
          setIsReconnecting(false);
        }
      }
    });

    return () => {
      socket.off('playerId');
      socket.off('playerJoined', handlePlayerJoined);
      socket.off('gameStarted', handleGameStarted);
      socket.off('nextGameStarted', handleNextGameStarted);
      socket.off('playerLeft', handlePlayerLeft);
      socket.off('showAnswer');
      socket.off('votingStarted');
      socket.off('voteResult');
      socket.off('answerReveal');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chatMessage', handleChatMessage);
    };
  }, [socket, roomId, playerName, reconnectAttempts]);

  // Optimize image loading
  const questionImage = useMemo(() => {
    if (!room?.currentQuestion?.content) return null;
    return (
      <img
        src={backendUrl + room.currentQuestion.content}
        alt="题目图片"
        style={{ maxWidth: '100%', maxHeight: 300, display: 'block', margin: '16px auto' }}
        loading="lazy"
      />
    );
  }, [room?.currentQuestion?.content]);

  const answerImage = useMemo(() => {
    if (!answerReveal.answer?.endsWith('.png')) return null;
    return (
      <img
        src={backendUrl + answerReveal.answer}
        alt="答案图片"
        style={{ maxWidth: '100%', maxHeight: 300, display: 'block', margin: '16px auto' }}
        loading="lazy"
      />
    );
  }, [answerReveal.answer]);

  // Add game progress indicator
  const GameProgress = () => {
    if (!room || typeof room.round !== 'number' || typeof room.totalRounds !== 'number') return null;

    return (
      <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="subtitle1">游戏进度：</Typography>
          <Box sx={{ flex: 1, display: 'flex', gap: 1 }}>
            {Array.from({ length: room.totalRounds }).map((_, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: 8,
                  bgcolor: i <= room.round ? 'primary.main' : 'action.disabled',
                  borderRadius: 1
                }}
              />
            ))}
          </Box>
          <Typography variant="subtitle1">
            {room.round + 1}/{room.totalRounds}
          </Typography>
        </Box>
      </Paper>
    );
  };

  // Add score summary with type safety
  const RoleDisplay = () => {
    return null; // Removed role display component
  };

  // Add early return for room closure display
  if (roomClosed) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        minHeight: '50vh',
        textAlign: 'center',
        p: 3
      }}>
        <Typography variant="h4" color="error" gutterBottom>
          房间已关闭
        </Typography>
        <Typography variant="h6" gutterBottom>
          {roomClosed.message}
        </Typography>
        {roomClosed.shouldRedirect && (
          <Typography variant="body1" color="text.secondary">
            正在返回大厅...
          </Typography>
        )}
        <Button
          variant="contained"
          color="primary"
          onClick={() => {
            localStorage.removeItem('currentRoomId');
            localStorage.removeItem('currentPlayerName');
            window.location.href = '/';
          }}
          sx={{ mt: 3 }}
        >
          返回大厅
        </Button>
      </Box>
    );
  }

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

  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Backdrop />
      <ReconnectionModal />
      <RoundTransition />
      <Box sx={{ flex: 1 }}>
        {/* Game Header */}
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.light', color: 'white' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <Box>
              <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          房间号: {roomId}
        </Typography>
              <Typography variant="subtitle1">
                第 {room.round + 1}/{room.totalRounds} 局
              </Typography>
            </Box>
            <Button
              variant="contained"
            color="error" 
            onClick={handleLeaveGame}
              sx={{ bgcolor: 'error.light', '&:hover': { bgcolor: 'error.main' } }}
          >
            离开游戏
          </Button>
        </Box>
        </Paper>

        <GameProgress />
        
        {/* Voice Chat */}
        {room && playerId && (
          <Paper sx={{ 
            p: 2, 
            mb: 2, 
            bgcolor: 'background.paper',
            borderRadius: 2,
            boxShadow: 2,
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'linear-gradient(90deg, #1976d2, #64b5f6)',
            }
          }}>
            <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 1
            }}>
              <Typography 
                variant="subtitle1" 
                color="primary"
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  gap: 1,
                  fontWeight: 500
                }}
              >
                <Mic fontSize="small" />
                语音聊天
              </Typography>
            </Box>
            <VoiceChat 
              socket={socket}
              roomId={roomId}
              playerId={playerId}
              players={room.players} 
            />
          </Paper>
        )}
        
        {/* Player Info */}
        <Paper sx={{ p: 0, mb: 2, bgcolor: 'background.paper', overflow: 'hidden', borderRadius: 2, boxShadow: 2 }}>
          <Box sx={{ 
            bgcolor: 'primary.dark', 
            p: 2, 
            color: 'white', 
            position: 'relative',
            overflow: 'hidden',
            '&::after': {
              content: '""',
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background: 'linear-gradient(45deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 70%)',
              zIndex: 1
            }
          }}>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 0.5, position: 'relative', zIndex: 2 }}>
              {myRoleLabel}
            </Typography>
            {smartPlayer && (
              <Typography variant="subtitle1" sx={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center' }}>
                <Chip 
                  label="大聪明" 
                  size="small" 
                  color="secondary" 
                  sx={{ mr: 1, fontWeight: 'bold' }}
                />
                {smartPlayer.name}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 2, position: 'relative', bgcolor: 'background.paper' }}>
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              pb: 2,
              borderBottom: '1px dashed rgba(0,0,0,0.1)'
            }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                游戏状态
              </Typography>
              <Chip 
                label={
                  phase === 'waiting' ? '等待开始' :
                  phase === 'playing' ? '游戏进行中' :
                  phase === 'voting' ? '投票环节' :
                  phase === 'ended' ? '本轮结束' : '游戏结束'
                }
                color={
                  phase === 'waiting' ? 'default' :
                  phase === 'playing' ? 'primary' :
                  phase === 'voting' ? 'secondary' :
                  phase === 'ended' ? 'success' : 'error'
                }
                variant="filled"
                size="medium"
                sx={{ fontWeight: 'bold' }}
              />
            </Box>
            {phase === 'playing' && isSmart && (
              <Button 
                variant="contained" 
                color="secondary" 
                onClick={handleStartVoting} 
                disabled={!canStartVoting}
                sx={{ 
                  mt: 2,
                  width: '100%',
                  py: 1,
                  borderRadius: 2,
                  boxShadow: 2
                }}
              >
                进入投票环节
              </Button>
            )}
          </Box>
        </Paper>

        {/* Main Game Content */}
        <Paper sx={{ p: 2, mb: 2, minHeight: '300px' }}>
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
                <Typography variant="h6" gutterBottom color="primary">玩家列表</Typography>
            {room.players.map(player => (
                  <Paper 
                    key={player.id} 
                    sx={{ 
                      p: 2, 
                      mb: 1.5, 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      bgcolor: player.id === playerName ? 'action.selected' : 'background.paper',
                      borderRadius: 2,
                      boxShadow: 2,
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: 3,
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Avatar sx={{ bgcolor: stringToColor(player.name), mr: 1.5 }}>
                        {player.name.charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography fontWeight={player.id === playerName ? 'bold' : 'normal'}>
                          {player.name} 
                          {player.id === playerName && ' （你）'} 
                        </Typography>
                        {player.id === room.players[0]?.id && (
                          <Chip 
                            size="small" 
                            label="房主" 
                            color="primary" 
                            variant="outlined" 
                            sx={{ ml: 1, height: 20 }} 
                          />
                        )}
                      </Box>
                    </Box>
                    <Chip 
                      label={`${player.score} 分`} 
                      color={player.score > 0 ? 'success' : 'default'}
                      variant={player.score > 0 ? 'filled' : 'outlined'}
                    />
                  </Paper>
            ))}
          </Box>
        </Box>
      )}

      {phase === 'playing' && room.currentQuestion && (
        <Box>
              <Typography variant="h6" gutterBottom sx={{ color: 'primary.main' }}>当前题目：</Typography>
              <Box sx={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                minHeight: '300px',
                bgcolor: 'background.default',
                borderRadius: 1,
                p: 2
              }}>
                {questionImage}
              </Box>
              <Box sx={{ mt: 2 }}>
                <HonestButton
                  me={me}
                  phase={phase}
                  answerRevealShowing={answerReveal.showing}
                  onUseHonestButton={handleUseHonestButton}
                />
                <AnswerDisplay
                  showing={answerReveal.showing}
                  answer={answerReveal.answer}
                  countdown={countdown}
                  backendUrl={backendUrl}
                />
              </Box>
            </Box>
          )}

          {phase === 'voting' && (
            <Box>
              {isSmart ? (
                <VoteSection
                  players={room.players}
                  smartPlayerId={me?.id || ''}
                  honestVoteTarget={honestVoteTarget}
                  liarVoteTarget={liarVoteTarget}
                  onHonestVoteSelect={handleHonestVoteSelect}
                  onLiarVoteSelect={handleLiarVoteSelect}
                  onVoteSubmit={handleVote}
                />
              ) : (
                <Typography variant="h6" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                  等待大聪明投票...
                </Typography>
              )}
            </Box>
          )}

          {(phase === 'ended' || phase === 'completed') && voteResult && (
            <Box>
              <Typography variant="h6" color="primary" gutterBottom>投票结果：</Typography>
              <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
                <Typography>
                  大聪明（{room.players.find(p => p.id === voteResult.voterId)?.name}）认为：
                </Typography>
                <Typography sx={{ mt: 1 }}>
                  老实人是 {room.players.find(p => p.id === voteResult.honestTargetId)?.name}
                  {voteResult.isHonestCorrect ? 
                    <span style={{ color: 'green' }}> ✅ 正确</span> : 
                    <span style={{ color: 'red' }}> ❌ 错误</span>
                  }
                </Typography>
                {voteResult.liarTargetId && (
                  <Typography sx={{ mt: 1 }}>
                    瞎掰人是 {room.players.find(p => p.id === voteResult.liarTargetId)?.name}
                    {voteResult.isLiarCorrect ? 
                      <span style={{ color: 'green' }}> ✅ 正确</span> : 
                      <span style={{ color: 'red' }}> ❌ 错误</span>
                    }
                  </Typography>
                )}
              </Paper>

              <Typography variant="h6" color="primary" gutterBottom>本轮得分：</Typography>
              <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                {room.players.map(player => {
                  const isSmartPlayer = player.id === voteResult.voterId;
                  const isHonestPlayer = player.role === 'honest';
                  const isLiarPlayer = player.role === 'liar';
                  
                  // Calculate score changes based on the new rules
                  let scoreChange = 0;
                  let explanation = '';
                  
                  if (isSmartPlayer) {
                    if (voteResult.isHonestCorrect) {
                      scoreChange = voteResult.pointsEarned;
                      explanation = '✅ 成功找出老实人！';
                    } else {
                      scoreChange = -2;
                      explanation = '❌ 没有找出老实人（-2分）';
                    }
                  } else if (isHonestPlayer) {
                    if (!voteResult.isHonestCorrect) {
                      scoreChange = 3;
                      explanation = '✅ 成功隐藏身份（+3分）';
                    } else {
                      scoreChange = 0;
                      explanation = '❌ 身份被识破';
                    }
                  } else if (isLiarPlayer) {
                    if (!voteResult.isHonestCorrect) {
                      scoreChange = 1;
                      explanation = '✅ 成功误导大聪明（+1分）';
                    } else {
                      scoreChange = -1;
                      explanation = '❌ 被大聪明识破（-1分）';
                    }
                  }

                  return (
                    <Box 
                      key={player.id}
                      sx={{ 
                        mb: 2,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        boxShadow: 1,
                        border: '1px solid',
                        borderColor: isSmartPlayer ? 'primary.main' : 
                                   isHonestPlayer ? 'success.main' : 
                                   'warning.main',
                        position: 'relative',
                        overflow: 'hidden',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '4px',
                          height: '100%',
                          bgcolor: isSmartPlayer ? 'primary.main' : 
                                   isHonestPlayer ? 'success.main' : 
                                   'warning.main'
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar 
                            sx={{ 
                              bgcolor: isSmartPlayer ? 'primary.main' : 
                                      isHonestPlayer ? 'success.main' : 
                                      'warning.main'
                            }}
                          >
                            {player.name.charAt(0).toUpperCase()}
                          </Avatar>
                          <Typography variant="h6">
                            {player.name}
                          </Typography>
                        </Box>
                        <Chip 
                          label={isSmartPlayer ? '大聪明' : 
                                isHonestPlayer ? '老实人' : 
                                '瞎掰人'}
                          color={isSmartPlayer ? 'primary' : 
                                isHonestPlayer ? 'success' : 
                                'warning'}
                          variant="outlined"
                          sx={{ fontWeight: 'bold' }}
                        />
                      </Box>
                      
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                        <Typography variant="body1" sx={{ flex: 1 }}>
                          {explanation}
                        </Typography>
                        <Box sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1,
                          bgcolor: 'background.default',
                          p: 1,
                          borderRadius: 1
                        }}>
                          <Typography 
                            variant="h6" 
                            sx={{ 
                              color: scoreChange > 0 ? 'success.main' : 
                                     scoreChange < 0 ? 'error.main' : 
                                     'text.secondary',
                              fontWeight: 'bold'
                            }}
                          >
                            {scoreChange > 0 ? '+' : ''}{scoreChange}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">分</Typography>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}

                {/* Add scoring rules explanation */}
                <Box sx={{ mt: 3, p: 2, bgcolor: 'info.main', color: 'white', borderRadius: 2 }}>
                  <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                    计分规则：
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    • 大聪明胜利：正确指认 → 全体瞎掰人各扣1分
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    • 老实人胜利：未被发现 → 大聪明扣2分，老实人+3分
                  </Typography>
                  <Typography variant="body2">
                    • 瞎掰人胜利：大聪明指错人 → 每个成功误导的瞎掰人+1分
                  </Typography>
                </Box>
              </Paper>
              
              {phase === 'completed' && voteResult?.gameWinner && (
                <Paper sx={{ mt: 3, p: 3, bgcolor: 'success.light', color: 'white' }}>
                  <Typography variant="h5" gutterBottom sx={{ textAlign: 'center' }}>
                    🎉 游戏结束！
                  </Typography>
                  <Typography variant="h6" gutterBottom sx={{ textAlign: 'center' }}>
                    获胜者：{voteResult?.gameWinner?.name}
                  </Typography>
                  <Typography variant="subtitle1" gutterBottom sx={{ textAlign: 'center' }}>
                    最终得分：{voteResult?.gameWinner?.score} 分
                  </Typography>
                  <Divider sx={{ my: 2, bgcolor: 'white' }} />
                  <Typography variant="h6" gutterBottom>
                    所有玩家得分：
                  </Typography>
                  {room.players
                    .sort((a, b) => b.score - a.score)
                    .map(player => (
                      <Box 
                        key={player.id}
                        sx={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          p: 1,
                          bgcolor: player.id === voteResult?.gameWinner?.id ? 'success.main' : 'transparent',
                          borderRadius: 1,
                          mt: 1
                        }}
                      >
                        <Typography>
                          {player.name} {player.id === voteResult?.gameWinner?.id && ' 👑'}
                        </Typography>
                        <Typography>
                          {player.score} 分
              </Typography>
          </Box>
                    ))
                  }
                </Paper>
              )}

              {/* Add Next Question Button for Host */}
              {isRoomCreator && phase === 'ended' && !voteResult.isGameOver && (
                <Box sx={{ mt: 3, textAlign: 'center' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    onClick={handleNextGame}
                    startIcon={<PlayArrow />}
                    sx={{ 
                      py: 1.5,
                      px: 4,
                      borderRadius: 2,
                      boxShadow: 3,
                      transition: 'transform 0.2s',
                      '&:hover': {
                        transform: 'scale(1.05)',
                        boxShadow: 4
                      }
                    }}
                  >
                    进入下一题
                  </Button>
                </Box>
              )}
        </Box>
      )}
        </Paper>

        {/* Player List */}
        {phase !== 'waiting' && (
          <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 3 }}>
            <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center' }}>
              <PeopleAlt sx={{ mr: 1 }} /> 玩家列表
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {room.players.map(player => (
                <Paper 
                  key={player.id}
                  sx={{ 
                    p: 2,
                    flex: '1 1 200px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    bgcolor: player.id === playerName ? 'action.selected' : 'background.paper',
                    borderRadius: 2,
                    boxShadow: 1,
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: 2,
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar sx={{ bgcolor: stringToColor(player.name), mr: 1.5 }}>
                      {player.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography fontWeight={player.id === playerName ? 'bold' : 'normal'}>
                        {player.name} 
                        {player.id === playerName && ' （你）'} 
                      </Typography>
                      {player.id === room.players[0]?.id && (
                        <Chip 
                          size="small" 
                          label="房主" 
                          color="primary" 
                          variant="outlined" 
                          sx={{ ml: 1, height: 20 }} 
                        />
                      )}
                    </Box>
                  </Box>
                  <Chip 
                    label={`${player.score} 分`} 
                    color={player.score > 0 ? 'success' : 'default'}
                    variant={player.score > 0 ? 'filled' : 'outlined'}
                    sx={{ fontWeight: 'bold' }}
                  />
                </Paper>
              ))}
            </Box>
          </Paper>
          )}
        </Box>

      {/* Chat Section */}
      <Box sx={{ width: '300px', flexShrink: 0 }}>
        <ChatSection
          messages={messages}
          onSendMessage={handleSendMessage}
        />
        </Box>
      </Box>
    );
};

export default GameRoom; 