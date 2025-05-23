import React, { useEffect, useState } from 'react';
import { Button, Badge, Tooltip, Box, Typography, IconButton, Snackbar, Alert, CircularProgress, Paper } from '@mui/material';
import { Mic, MicOff, GroupAdd, Person, Refresh } from '@mui/icons-material';
import { Socket } from 'socket.io-client';
import voiceChat from '../services/voiceChat';

interface VoiceChatProps {
  socket: Socket;
  roomId: string;
  playerId: string;
  players: Array<{ id: string; name: string }>;
}

const VoiceChat: React.FC<VoiceChatProps> = ({ socket, roomId, playerId, players }) => {
  const [isActive, setIsActive] = useState(false);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSnackbar, setShowSnackbar] = useState(false);

  useEffect(() => {
    // Initialize voice chat service
    voiceChat.init(socket, roomId, playerId);
    
    // Set up state change handler
    voiceChat.setVoiceStateChangeHandler((active) => {
      console.log("Voice state changed to:", active);
      setIsActive(active);
      setIsInitializing(false);
      
      // If we tried to start but it didn't activate, show error
      if (!active && isInitializing) {
        setError("语音连接失败，请检查麦克风权限并重试");
        setShowSnackbar(true);
      }
    });
    
    // Add listener for active users update
    const handleActiveUsersUpdate = (data: { 
      users: string[], 
      peerIds?: Record<string, string> 
    }) => {
      console.log('Received voice users update:', data);
      setActiveUsers(data.users);
    };
    
    socket.on('voice-users', handleActiveUsersUpdate);
    
    // Clean up on unmount
    return () => {
      console.log("Cleaning up voice chat component");
      socket.off('voice-users', handleActiveUsersUpdate);
      voiceChat.cleanup();
    };
  }, [socket, roomId, playerId]);
  
  // Update isInitializing when it changes
  useEffect(() => {
    console.log("Initializing state:", isInitializing);
    if (isInitializing) {
      // Set a timeout to show an error if initialization takes too long
      const timeout = setTimeout(() => {
        if (isInitializing) {
          setIsInitializing(false);
          setError("语音连接超时，请重试");
          setShowSnackbar(true);
        }
      }, 15000); // 15 seconds timeout
      
      return () => clearTimeout(timeout);
    }
  }, [isInitializing]);
  
  const toggleVoice = () => {
    try {
      if (isActive) {
        voiceChat.toggleVoice();
      } else {
        setIsInitializing(true);
        setError(null);
        voiceChat.toggleVoice();
      }
    } catch (err) {
      console.error("Error toggling voice chat:", err);
      setIsInitializing(false);
      setError("启动语音聊天时出错");
      setShowSnackbar(true);
    }
  };
  
  const retry = () => {
    setIsInitializing(true);
    setError(null);
    
    // Force stop and restart
    voiceChat.stopVoice();
    setTimeout(() => {
      voiceChat.startVoice();
    }, 1000);
  };
  
  // Count active users excluding self
  const activeCount = activeUsers.filter(id => id !== playerId).length;

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      width: '100%',
      position: 'relative'
    }}>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center',
        gap: 3,
        width: '100%',
        justifyContent: 'flex-start',
        pl: 2
      }}>
        <Tooltip title={isActive ? "点击关闭语音" : "点击开启语音聊天"}>
          <IconButton 
            onClick={toggleVoice}
            color={isActive ? "primary" : "default"}
            disabled={isInitializing}
            sx={{ 
              border: isActive ? '2px solid #1976d2' : '2px solid #bdbdbd',
              borderRadius: '50%',
              p: 1.5,
              transition: 'all 0.3s ease',
              position: 'relative',
              bgcolor: isActive ? 'primary.light' : 'background.default',
              '&:hover': {
                transform: 'scale(1.05)',
                boxShadow: isActive ? 3 : 1,
                bgcolor: isActive ? 'primary.light' : 'action.hover'
              }
            }}
          >
            {isInitializing && (
              <Box sx={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '50%',
                zIndex: 10
              }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {isActive ? (
              <Badge 
                badgeContent={activeCount} 
                color="success" 
                overlap="circular"
                sx={{
                  '& .MuiBadge-badge': {
                    bgcolor: '#2e7d32',
                    color: 'white',
                    boxShadow: 1
                  }
                }}
              >
                <Mic sx={{ color: 'white' }} />
              </Badge>
            ) : (
              <MicOff />
            )}
          </IconButton>
        </Tooltip>

        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column',
          flex: 1
        }}>
          <Typography 
            variant="body1" 
            color={isActive ? 'primary' : 'text.secondary'}
            sx={{ 
              fontWeight: 'medium',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            {isInitializing ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                正在连接...
              </Box>
            ) : isActive ? (
              <>
                <Box 
                  component="span" 
                  sx={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    bgcolor: 'success.main',
                    animation: 'pulse 1.5s infinite'
                  }} 
                />
                已连接 {activeCount} 位玩家
              </>
            ) : (
              '点击开启语音'
            )}
          </Typography>
          
          {error && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <Typography 
                variant="caption" 
                color="error"
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                {error}
                <Tooltip title="重试连接">
                  <IconButton onClick={retry} size="small" sx={{ p: 0.5 }}>
                    <Refresh fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      
      {isActive && activeUsers.length > 0 && (
        <Box sx={{ 
          mt: 2,
          display: 'flex', 
          gap: 1.5, 
          flexWrap: 'wrap', 
          px: 2
        }}>
          {activeUsers.map(userId => {
            const player = players.find(p => p.id === userId);
            return player ? (
              <Tooltip key={userId} title={`${player.name}${userId === playerId ? ' (你)' : ''}`}>
                <Paper
                  elevation={userId === playerId ? 2 : 1}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    bgcolor: userId === playerId ? 'primary.light' : 'background.default',
                    borderRadius: '20px',
                    border: '1px solid',
                    borderColor: userId === playerId ? 'primary.main' : 'divider',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: 2
                    }
                  }}
                >
                  <Person 
                    fontSize="small" 
                    sx={{ 
                      color: userId === playerId ? 'primary.main' : 'action.active'
                    }} 
                  />
                  <Typography 
                    variant="body2"
                    sx={{ 
                      color: userId === playerId ? 'primary.main' : 'text.primary',
                      fontWeight: userId === playerId ? 500 : 400
                    }}
                  >
                    {player.name}
                  </Typography>
                </Paper>
              </Tooltip>
            ) : null;
          })}
        </Box>
      )}
      
      <Snackbar 
        open={showSnackbar && error !== null} 
        autoHideDuration={6000} 
        onClose={() => setShowSnackbar(false)}
      >
        <Alert 
          onClose={() => setShowSnackbar(false)} 
          severity="error" 
          sx={{ width: '100%' }}
        >
          {error}
        </Alert>
      </Snackbar>

      <style>
        {`
          @keyframes pulse {
            0% {
              transform: scale(0.95);
              box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.7);
            }
            
            70% {
              transform: scale(1);
              box-shadow: 0 0 0 6px rgba(46, 125, 50, 0);
            }
            
            100% {
              transform: scale(0.95);
              box-shadow: 0 0 0 0 rgba(46, 125, 50, 0);
            }
          }
        `}
      </style>
    </Box>
  );
};

export default VoiceChat; 