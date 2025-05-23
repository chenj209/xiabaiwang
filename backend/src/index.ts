import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import { Room, Player, Question } from './types';
import fs from 'fs';
import path from 'path';

const app = express();
const httpServer = createServer(app);

// Create HTTPS server if SSL certificates are available
let httpsServer: any = null;
const sslKeyPath = path.join(__dirname, '../ssl/server.key');
const sslCertPath = path.join(__dirname, '../ssl/server.crt');

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    try {
        const privateKey = fs.readFileSync(sslKeyPath, 'utf8');
        const certificate = fs.readFileSync(sslCertPath, 'utf8');
        const credentials = { key: privateKey, cert: certificate };
        httpsServer = createHttpsServer(credentials, app);
        console.log('SSL certificates found, HTTPS server will be created');
    } catch (error) {
        console.log('SSL certificates found but invalid, falling back to HTTP only:', error);
    }
} else {
    console.log('No SSL certificates found, running HTTP only');
}

// Add player session store
const playerSessions: { [key: string]: { playerId: string, roomId: string, playerName: string } } = {};

// Add voice chat participants tracking with peer IDs
const voiceParticipants: { [roomId: string]: Map<string, string> } = {}; // Map of playerId -> peerId

// Add closed rooms tracking
const closedRooms: { [key: string]: { message: string; closedAt: number } } = {};

// Add efficient room data caching
const roomCache = new Map<string, {
    roomData: any;
    lastUpdate: number;
}>();

// Add function to remove player from all rooms
const removePlayerFromAllRooms = (playerId: string) => {
    const session = playerSessions[playerId];
    if (session) {
        const room = gameState.rooms[session.roomId];
        if (room) {
            room.players = room.players.filter(p => p.id !== playerId);
            if (room.players.length === 0) {
                delete gameState.rooms[session.roomId];
            }
        }
        delete playerSessions[playerId];
        
        // Remove from voice participants if present
        if (voiceParticipants[session.roomId]) {
            voiceParticipants[session.roomId].delete(playerId);
            broadcastVoiceParticipants(session.roomId);
        }
    }
};

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const io = new Server(httpServer, {
    cors: {
        origin: [
            "http://8.148.30.163", 
            "http://8.148.30.163:3001", 
            "https://8.148.30.163", 
            "https://8.148.30.163:3443",
            "http://localhost:3000",
            "https://localhost:3000"
        ],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"]
    },
    transports: ['polling'],
    allowEIO3: true,
    pingTimeout: 10000,
    pingInterval: 5000,
    connectTimeout: 20000,
    allowUpgrades: false,
    maxHttpBufferSize: 1e8
});

// Attach to HTTPS server if available
if (httpsServer) {
    io.attach(httpsServer);
    console.log('Socket.IO attached to both HTTP and HTTPS servers');
} else {
    console.log('Socket.IO attached to HTTP server only');
}

// Add debug logging
io.engine.on("connection_error", (err) => {
    console.log('Connection error:', err);
});

io.engine.on("connection", (socket) => {
    console.log('New connection:', socket.id);
});

// Configure CORS for Express
app.use(cors({
    origin: [
        "http://8.148.30.163", 
        "http://8.148.30.163:3001", 
        "https://8.148.30.163", 
        "https://8.148.30.163:3443",
        "http://localhost:3000",
        "https://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Add error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.use(express.json());

const imagesPath = path.join(__dirname, '../../images');
app.use('/images', express.static(imagesPath));

app.use(express.static(path.join(__dirname, '../../frontend/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/build', 'index.html'));
});

// 游戏状态
const gameState: { rooms: { [key: string]: Room } } = {
    rooms: {}
};

// 示例题目
const sampleQuestions: Question[] = [
    {
        id: '1',
        content: '为什么天空是蓝色的？',
        answer: '因为大气层中的气体分子会散射太阳光，而蓝光的散射最强。'
    },
    {
        id: '2',
        content: '为什么海水是咸的？',
        answer: '因为河流将陆地上的盐分带入海洋，经过数百万年的积累。'
    }
];

// Add cleanup for old closed rooms
setInterval(() => {
    const now = Date.now();
    Object.entries(closedRooms).forEach(([roomId, data]) => {
        if (now - data.closedAt > 1000 * 60 * 60) { // Remove after 1 hour
            delete closedRooms[roomId];
        }
    });
}, 1000 * 60 * 5); // Check every 5 minutes

// Function to broadcast voice participants in a room
const broadcastVoiceParticipants = (roomId: string) => {
    const participants = voiceParticipants[roomId] || new Map();
    const participantsArray = Array.from(participants).map(([userId, peerId]) => ({
        userId,
        peerId
    }));
    
    io.to(roomId).emit('voice-users', {
        users: participantsArray.map(p => p.userId),
        peerIds: Object.fromEntries(participants)
    });
};

// Optimize room list broadcasting
const getRoomListData = () => {
    const now = Date.now();
    const cacheKey = 'roomList';
    const cached = roomCache.get(cacheKey);
    
    // Use cache if less than 1 second old
    if (cached && now - cached.lastUpdate < 1000) {
        return cached.roomData;
    }

    const availableRooms = Object.values(gameState.rooms)
        .filter(room => room.status !== 'completed')
        .map(room => ({
            id: room.id,
            playerCount: room.players.length,
            maxPlayers: room.maxPlayers,
            status: room.status,
            totalRounds: room.totalRounds,
            pointsToWin: room.pointsToWin,
            answerViewTime: room.answerViewTime,
            players: room.players.map(p => ({
                name: p.name,
                score: p.score,
                isCreator: p.id === room.players[0]?.id
            }))
        }));

    // Cache the result
    roomCache.set(cacheKey, {
        roomData: availableRooms,
        lastUpdate: now
    });

    return availableRooms;
};

// Optimize broadcast function
const broadcastRoomList = () => {
    try {
        const availableRooms = getRoomListData();
        io.emit('roomList', availableRooms);
    } catch (error) {
        console.error('Error in broadcastRoomList:', error);
    }
};

// Clean up old cache entries
setInterval(() => {
    const now = Date.now();
    roomCache.forEach((value, key) => {
        if (now - value.lastUpdate > 5000) { // Remove after 5 seconds
            roomCache.delete(key);
        }
    });
}, 5000);

// Optimize image loading
const imageCache = new Map<string, { path: string, lastAccess: number }>();
const loadImages = () => {
    const faceDir = path.join(__dirname, '../../images/face');
    const backDir = path.join(__dirname, '../../images/back');
    try {
        const files = fs.readdirSync(faceDir).filter(f => f.endsWith('.png'));
        files.forEach(file => {
            imageCache.set(file, {
                path: file,
                lastAccess: Date.now()
            });
        });
    } catch (error) {
        console.error('Error loading images:', error);
    }
};

// Load images on startup
loadImages();

// Optimize socket connection options
io.engine.opts.pingInterval = 10000; // Reduce ping interval
io.engine.opts.pingTimeout = 5000; // Reduce ping timeout

// Socket.IO 连接处理
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let currentPlayerId = "";
    let currentRoomId = "";
    let currentPlayerName = "";
    
    // 添加连接状态检查
    const connectionCheck = setInterval(() => {
        if (!socket.connected) {
            console.log('Socket disconnected, cleaning up:', socket.id);
            clearInterval(connectionCheck);
            handleDisconnect();
        }
    }, 3000); // 每3秒检查一次连接状态
    
    const handleDisconnect = () => {
        console.log('User disconnected:', socket.id);
        // 清理连接检查
        if (connectionCheck) {
            clearInterval(connectionCheck);
        }
        
        // 立即清理房间数据
        Object.entries(gameState.rooms).forEach(([roomId, room]) => {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                const playerName = player.name;
                const isCreator = player.id === room.players[0]?.id;
                
                console.log(`Disconnected player ${playerName} found in room ${roomId}`);
                
                // Remove player from room
                room.players = room.players.filter(p => p.id !== socket.id);
                
                // Remove from voice chat if present
                if (voiceParticipants[roomId]) {
                    voiceParticipants[roomId].delete(socket.id);
                    broadcastVoiceParticipants(roomId);
                }
                
                if (isCreator || room.players.length === 0) {
                    // Store closed room state
                    closedRooms[roomId] = {
                        message: isCreator ? `房主 ${playerName} 已断开连接，房间已关闭` : '所有玩家已离开，房间已关闭',
                        closedAt: Date.now()
                    };
                    
                    console.log(`Room ${roomId} closed due to disconnection: ${closedRooms[roomId].message}`);
                    
                    // Notify remaining players
                    io.to(roomId).emit('roomClosed', { 
                        message: closedRooms[roomId].message,
                        shouldRedirect: isCreator
                    });
                    
                    // Remove all sockets from room
                    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
                    if (socketsInRoom) {
                        socketsInRoom.forEach(socketId => {
                            io.sockets.sockets.get(socketId)?.leave(roomId);
                        });
                    }
                    
                    delete gameState.rooms[roomId];
                    cleanupRoom(roomId);
                } else {
                    // Notify remaining players of disconnection
                    console.log(`Player ${playerName} disconnected from room ${roomId}, ${room.players.length} players remaining`);
                    io.to(roomId).emit('playerLeft', {
                        playerName: playerName,
                        playerId: socket.id,
                        room: room
                    });
                    io.to(roomId).emit('playerJoined', room);
                }
            }
        });
        
        // Clean up player sessions
        delete playerSessions[socket.id];
        
        // Handle voice chat cleanup on disconnect
        if (currentPlayerId && currentRoomId && voiceParticipants[currentRoomId]) {
            voiceParticipants[currentRoomId].delete(currentPlayerId);
            socket.to(currentRoomId).emit('user-left-voice', {
                userId: currentPlayerId
            });
            broadcastVoiceParticipants(currentRoomId);
        }
        
        // Broadcast updated room list immediately
        broadcastRoomList();
    };

    // Handle reconnection
    socket.on('reconnect', (data: { playerId: string }) => {
        const session = playerSessions[data.playerId];
        if (session) {
            const room = gameState.rooms[session.roomId];
            if (room) {
                // Update the player's socket ID
                const player = room.players.find(p => p.id === session.playerId);
                if (player) {
                    player.id = socket.id;
                    socket.join(session.roomId);
                    io.to(session.roomId).emit('playerJoined', room);
                }
            }
        }
    });

    // 创建房间
    socket.on('createRoom', (data: { maxPlayers: number, totalRounds: number, pointsToWin: number, answerViewTime: number }) => {
        console.log('Creating room with data:', data);
        const roomId = Math.random().toString(36).substring(7);
        const room: Room = {
            id: roomId,
            players: [],
            maxPlayers: data.maxPlayers,
            totalRounds: data.totalRounds,
            pointsToWin: data.pointsToWin,
            answerViewTime: data.answerViewTime,
            status: 'waiting',
            round: 0,
            currentSmartIndex: 0 // Track the index of the current smart player
        };
        gameState.rooms[roomId] = room;
        socket.join(roomId);
        console.log('Room created:', room);
        socket.emit('roomCreated', { id: roomId, room });
        broadcastRoomList(); // Broadcast updated room list
    });

    // 加入房间
    socket.on('joinRoom', (data: { roomId: string, playerName: string }) => {
        const { roomId, playerName } = data;
        
        // Check closed rooms first (most efficient check)
        if (closedRooms[roomId]) {
            socket.emit('roomClosed', {
                message: closedRooms[roomId].message,
                shouldRedirect: true
            });
            return;
        }

        const room = gameState.rooms[roomId];
        if (!room) {
            socket.emit('error', '房间不存在');
            return;
        }

        // Quick validation checks
        if (room.status !== 'waiting' && !room.players.find(p => p.name === playerName)) {
            socket.emit('error', '游戏已经开始，无法加入');
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            socket.emit('error', '房间已满');
            return;
        }

        // Handle existing player
        const existingPlayer = room.players.find(p => p.name === playerName);
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            socket.join(roomId);
            socket.emit('playerId', playerName);
            io.to(roomId).emit('playerJoined', room);
            
            // Store current player information in socket scope
            currentPlayerId = socket.id;
            currentRoomId = roomId;
            currentPlayerName = playerName;
            
            // Also store in player sessions
            playerSessions[socket.id] = {
                playerId: socket.id,
                roomId: roomId,
                playerName: playerName
            };
            
            broadcastRoomList();
            return;
        }

        // Add new player
        const player: Player = {
            id: socket.id,
            name: playerName,
            role: 'liar',
            score: 0,
            hasUsedHonestButton: false
        };

        room.players.push(player);
        socket.join(roomId);
        
        // Cache room data
        const cacheKey = `room:${roomId}`;
        roomCache.set(cacheKey, {
            roomData: room,
            lastUpdate: Date.now()
        });

        // Store current player information in socket scope
        currentPlayerId = socket.id;
        currentRoomId = roomId;
        currentPlayerName = playerName;
        
        socket.emit('playerId', playerName);
        io.to(roomId).emit('playerJoined', room);
        broadcastRoomList();

        // Store session
        playerSessions[socket.id] = {
            playerId: socket.id,
            roomId: roomId,
            playerName: playerName
        };
    });

    // 离开游戏
    socket.on('leaveGame', (data: { roomId: string, playerId: string }) => {
        const { roomId, playerId } = data;
        const room = gameState.rooms[roomId];
        
        console.log(`Player ${playerId} leaving room ${roomId}`);
        
        if (room) {
            const playerName = room.players.find(p => p.id === playerId)?.name || playerId;
            const isCreator = playerId === room.players[0]?.id;
            
            // Remove player from room
            room.players = room.players.filter(p => p.id !== playerId);
            
            // Remove from voice chat if present
            if (voiceParticipants[roomId]) {
                voiceParticipants[roomId].delete(playerId);
                broadcastVoiceParticipants(roomId);
            }
            
            if (isCreator || room.players.length === 0) {
                // Store closed room state
                closedRooms[roomId] = {
                    message: isCreator ? `房主 ${playerName} 已离开，房间已关闭` : '所有玩家已离开，房间已关闭',
                    closedAt: Date.now()
                };
                
                console.log(`Room ${roomId} closed: ${closedRooms[roomId].message}`);
                
                // Notify all remaining players and then close
                io.to(roomId).emit('roomClosed', { 
                    message: closedRooms[roomId].message,
                    shouldRedirect: isCreator
                });
                
                // Remove all sockets from room
                const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
                if (socketsInRoom) {
                    socketsInRoom.forEach(socketId => {
                        io.sockets.sockets.get(socketId)?.leave(roomId);
                    });
                }
                
                // Delete room
                delete gameState.rooms[roomId];
                cleanupRoom(roomId);
            } else {
                // Notify remaining players of player leaving
                console.log(`Player ${playerName} left room ${roomId}, ${room.players.length} players remaining`);
                io.to(roomId).emit('playerLeft', {
                    playerName: playerName,
                    playerId: playerId,
                    room: room
                });
                io.to(roomId).emit('playerJoined', room);
            }
            
            // Remove player session
            delete playerSessions[playerId];
            
            // Broadcast updated room list immediately
            broadcastRoomList();
            
            // Make sure the leaving player also leaves the socket room
            socket.leave(roomId);
        }
    });

    // Add timeout for 老实人
    let honestPlayerTimeouts: { [roomId: string]: NodeJS.Timeout } = {};

    // Add honest player button handler
    socket.on('useHonestButton', (roomId: string) => {
        console.log('Honest button clicked for room:', roomId);
        const room = gameState.rooms[roomId];
        if (!room || room.status !== 'playing') {
            console.log('Invalid room state:', room?.status);
            return;
        }

        const player = room.players.find(p => p.id === socket.id && p.role === 'honest');
        if (!player || player.hasUsedHonestButton) {
            console.log('Invalid player state:', player);
            return;
        }

        console.log('Processing honest button click for player:', player.name);
        
        // Set the view time
        const viewTimeMs = room.answerViewTime * 1000;
        const endTime = Date.now() + viewTimeMs;
        room.answerReveal = { showing: true, endTime };

        // Mark button as used
        player.hasUsedHonestButton = true;

        // Send answer to honest player immediately
        socket.emit('answerReveal', { 
            showing: true, 
            endTime,
            answer: room.currentQuestion?.answer,
            timeInSeconds: room.answerViewTime
        });

        // Notify other players (without showing answer)
        socket.to(roomId).emit('answerReveal', { 
            showing: true, 
            endTime,
            timeInSeconds: room.answerViewTime
        });

        // Set timeout to hide answer
        setTimeout(() => {
            if (room.answerReveal?.showing) {
                room.answerReveal = { showing: false, endTime: 0 };
                io.to(roomId).emit('answerReveal', { showing: false, endTime: 0 });
                io.to(roomId).emit('playerJoined', room);
            }
        }, viewTimeMs);

        // Broadcast updated room state
        io.to(roomId).emit('playerJoined', room);
    });

    // Add timeout for honest player if they don't click
    const setupHonestPlayerTimeout = (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (!room) return;

        const honestPlayer = room.players.find(p => p.role === 'honest');
        if (!honestPlayer) return;

        // Clear any existing timeout
        if (honestPlayerTimeouts[roomId]) {
            clearTimeout(honestPlayerTimeouts[roomId]);
        }

        // Set new timeout
        honestPlayerTimeouts[roomId] = setTimeout(() => {
            if (!room || !room.players.find(p => p.role === 'honest')?.hasUsedHonestButton) {
                const player = room.players.find(p => p.role === 'honest');
                if (player && !player.hasUsedHonestButton) {
                    console.log('Forcing honest player to view answer:', player.name);
                    
                    const viewTimeMs = room.answerViewTime * 1000;
                    const endTime = Date.now() + viewTimeMs;
                    room.answerReveal = { showing: true, endTime };

                    player.hasUsedHonestButton = true;

                    // Send answer to honest player
                    io.to(player.id).emit('answerReveal', { 
                        showing: true, 
                        endTime,
                        answer: room.currentQuestion?.answer,
                        timeInSeconds: room.answerViewTime
                    });

                    // Notify others
                    room.players.forEach(p => {
                        if (p.id !== player.id) {
                            io.to(p.id).emit('answerReveal', { 
                                showing: true, 
                                endTime,
                                timeInSeconds: room.answerViewTime
                            });
                        }
                    });

                    // Set timeout to hide answer
                    setTimeout(() => {
                        if (room.answerReveal?.showing) {
                            room.answerReveal = { showing: false, endTime: 0 };
                            io.to(roomId).emit('answerReveal', { showing: false, endTime: 0 });
                            io.to(roomId).emit('playerJoined', room);
                        }
                    }, viewTimeMs);

                    // Broadcast updated room state
                    io.to(roomId).emit('playerJoined', room);
                }
            }
        }, 30000); // 30 seconds to click button
    };

    // Fix startGame to assign the smart role to the first player
    socket.on('startGame', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (!room || room.status !== 'waiting') return;

        room.status = 'playing';
        room.currentSmartIndex = 0; // First player is smart in first round
        
        // Use cached images
        const files = Array.from(imageCache.keys());
        if (files.length === 0) {
            socket.emit('error', '没有可用的题目图片');
            return;
        }

        const randomFile = files[Math.floor(Math.random() * files.length)];
        const question = {
            id: randomFile,
            content: `/images/face/${randomFile}`,
            answer: `/images/back/${randomFile}`
        };
        room.currentQuestion = question;

        // Sequential role assignment for smart player (first player in first round)
        const smartIndex = room.currentSmartIndex;
        let honestIndex;
        do {
            honestIndex = Math.floor(Math.random() * room.players.length);
        } while (honestIndex === smartIndex);

        room.players.forEach((p, i) => {
            p.role = i === smartIndex ? 'smart' : i === honestIndex ? 'honest' : 'liar';
            p.hasUsedHonestButton = false; // Reset button state
        });

        // Setup timeout for honest player
        setupHonestPlayerTimeout(roomId);

        io.to(roomId).emit('gameStarted', { room, question });
        broadcastRoomList();
    });

    // Clean up timeout when game ends or room closes
    const cleanupRoom = (roomId: string) => {
        if (honestPlayerTimeouts[roomId]) {
            clearTimeout(honestPlayerTimeouts[roomId]);
            delete honestPlayerTimeouts[roomId];
        }
    };

    // 进入投票环节（只有大聪明可以发起）
    socket.on('startVoting', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room && room.status === 'playing' && !room.answerReveal?.showing) {
            const honestPlayer = room.players.find(p => p.role === 'honest');
            if (!honestPlayer || !honestPlayer.hasUsedHonestButton) {
                socket.emit('error', '老实人还未查看答案');
                return;
            }
            const smartPlayer = room.players.find(p => p.role === 'smart');
            if (smartPlayer && smartPlayer.id === socket.id) {
                room.status = 'voting';
                cleanupRoom(roomId); // Clean up timeout
                io.to(roomId).emit('votingStarted', { room });
                broadcastRoomList();
            }
        }
    });

    // Fix the automatic next game logic in vote handler
    socket.on('vote', (data: { roomId: string, honestTargetId: string, liarTargetId?: string }) => {
        const { roomId, honestTargetId, liarTargetId } = data;
        const room = gameState.rooms[roomId];
        if (room && room.status === 'voting') {
            const smartPlayer = room.players.find(p => p.role === 'smart');
            const honestPlayer = room.players.find(p => p.role === 'honest');
            if (smartPlayer && smartPlayer.id === socket.id) {
                room.voteResult = { 
                    voterId: socket.id, 
                    honestTargetId,
                    liarTargetId 
                };
                room.status = 'ended';
                
                // Award points for correct identifications
                let pointsEarned = 0;
                const isHonestCorrect = honestTargetId === honestPlayer?.id;
                
                // Points for 大聪明
                if (isHonestCorrect) {
                    pointsEarned += 2; // 2 points for correctly identifying 老实人
                }
                
                if (liarTargetId) {
                    const targetPlayer = room.players.find(p => p.id === liarTargetId);
                    if (targetPlayer?.role === 'liar') {
                        pointsEarned += 1; // 1 point for correctly identifying 瞎掰人
                    }
                }
                
                smartPlayer.score += pointsEarned;

                // Points for 老实人
                if (!isHonestCorrect && honestPlayer) {
                    honestPlayer.score += 3; // 3 points for not being discovered
                }

                // Points for 瞎掰人
                if (!isHonestCorrect) {
                    room.players
                        .filter(p => p.role === 'liar')
                        .forEach(p => p.score += 1); // 1 point for successful misdirection
                }

                // Check victory conditions
                const hasWinner = room.players.some(p => p.score >= room.pointsToWin);
                const isLastRound = room.round >= room.totalRounds - 1;
                const isGameOver = hasWinner || isLastRound;

                if (isGameOver) {
                    // Find player with highest score
                    const winner = room.players.reduce((prev, current) => 
                        (current.score > prev.score) ? current : prev
                    );
                    room.gameWinner = winner;
                    room.status = 'completed';
                }
                
                // Send vote result to all players
                io.to(roomId).emit('voteResult', { 
                    voterId: socket.id,
                    honestTargetId,
                    liarTargetId,
                    isHonestCorrect,
                    isLiarCorrect: liarTargetId ? room.players.find(p => p.id === liarTargetId)?.role === 'liar' : undefined,
                    pointsEarned,
                    smartPlayerScore: smartPlayer.score,
                    honestPlayerScore: honestPlayer?.score,
                    gameWinner: room.gameWinner,
                    isGameOver
                });

                // Automatically start next game after 5 seconds if game is not over
                if (!isGameOver) {
                    setTimeout(() => {
                        // 重置房间状态
                        room.status = 'playing';
                        room.round += 1;
                        room.voteResult = undefined;
                        room.answerReveal = undefined;

                        // Update the smart player index for the next round (safely handle undefined)
                        room.currentSmartIndex = ((room.currentSmartIndex ?? 0) + 1) % room.players.length;

                        // 重置玩家状态
                        room.players.forEach(player => {
                            player.hasUsedHonestButton = false;
                        });

                        // 随机选择新的图片题目
                        const files = Array.from(imageCache.keys());
                        if (files.length === 0) {
                            io.to(roomId).emit('error', '没有可用的题目图片');
                            return;
                        }
                        const randomFile = files[Math.floor(Math.random() * files.length)];
                        const question = {
                            id: randomFile,
                            content: `/images/face/${randomFile}`,
                            answer: `/images/back/${randomFile}`
                        };
                        room.currentQuestion = question;

                        // Sequential role assignment for smart player
                        const smartIndex = room.currentSmartIndex;
                        let honestIndex;
                        do {
                            honestIndex = Math.floor(Math.random() * room.players.length);
                        } while (honestIndex === smartIndex);

                        // Reset all roles to liar first
                        room.players.forEach(p => p.role = 'liar');
                        
                        // Assign smart and honest roles
                        room.players[smartIndex].role = 'smart';
                        room.players[honestIndex].role = 'honest';

                        // Setup timeout for honest player
                        setupHonestPlayerTimeout(roomId);

                        // 通知所有玩家新游戏开始
                        io.to(roomId).emit('nextGameStarted', {
                            room,
                            question
                        });
                    }, 5000);
                }
            }
        }
    });

    // Fix nextGame to use the tracked smart player index
    socket.on('nextGame', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room) {
            // 重置房间状态
            room.status = 'playing';
            room.round += 1;
            room.voteResult = undefined;
            room.answerReveal = undefined;

            // Update the smart player index for the next round (safely handle undefined)
            room.currentSmartIndex = ((room.currentSmartIndex ?? 0) + 1) % room.players.length;

            // 重置玩家状态
            room.players.forEach(player => {
                player.hasUsedHonestButton = false;
            });

            // 随机选择新的图片题目
            const faceDir = path.join(__dirname, '../../images/face');
            const backDir = path.join(__dirname, '../../images/back');
            const files = fs.readdirSync(faceDir).filter(f => f.endsWith('.png'));
            if (files.length === 0) {
                socket.emit('error', '没有可用的题目图片');
                return;
            }
            const randomFile = files[Math.floor(Math.random() * files.length)];
            const question = {
                id: randomFile,
                content: `/images/face/${randomFile}`,
                answer: `/images/back/${randomFile}`
            };
            room.currentQuestion = question;

            // Use the tracked smart player index
            const smartIndex = room.currentSmartIndex;
            let honestIndex;
            do {
                honestIndex = Math.floor(Math.random() * room.players.length);
            } while (honestIndex === smartIndex);

            // Reset all roles to liar first
            room.players.forEach(p => p.role = 'liar');
            
            // Assign smart and honest roles
            room.players[smartIndex].role = 'smart';
            room.players[honestIndex].role = 'honest';

            // Setup timeout for honest player
            setupHonestPlayerTimeout(roomId);

            // 通知所有玩家新游戏开始
            io.to(roomId).emit('nextGameStarted', {
                room,
                question
            });
        }
    });

    // Add this new event handler after the connection handler
    socket.on('getRooms', () => {
        console.log('Received getRooms request from socket:', socket.id);
        try {
            const availableRooms = Object.values(gameState.rooms)
                .filter(room => room.status !== 'completed') // Only show active rooms
                .map(room => ({
                    id: room.id,
                    playerCount: room.players.length,
                    maxPlayers: room.maxPlayers,
                    status: room.status,
                    totalRounds: room.totalRounds,
                    pointsToWin: room.pointsToWin,
                    answerViewTime: room.answerViewTime,
                    players: room.players.map(p => ({
                        name: p.name,
                        score: p.score,
                        isCreator: p.id === room.players[0]?.id
                    }))
                }));
            console.log(`Sending ${availableRooms.length} rooms to socket ${socket.id}`);
            socket.emit('roomList', availableRooms);
        } catch (error) {
            console.error('Error in getRooms:', error);
            socket.emit('error', '获取房间列表失败');
        }
    });

    // WebRTC voice chat signaling for PeerJS
    socket.on('store-peer-id', (data) => {
        const { roomId, peerId } = data;
        const playerId = currentPlayerId;
        
        if (!playerId || !roomId || !peerId) {
            console.error('Missing data for store-peer-id:', { playerId, roomId, peerId });
            return;
        }
        
        // Store the peer ID for this player
        if (!voiceParticipants[roomId]) {
            voiceParticipants[roomId] = new Map();
        }
        
        voiceParticipants[roomId].set(playerId, peerId);
        console.log(`Stored peer ID ${peerId} for player ${playerId} in room ${roomId}`);
        
        // Also broadcast updated participants to sync everyone
        broadcastVoiceParticipants(roomId);
    });
    
    socket.on('join-voice', (data) => {
        const { roomId, peerId } = data;
        const playerId = currentPlayerId;
        
        console.log('Join voice request:', { roomId, peerId, playerId });
        
        if (!playerId || !roomId) {
            socket.emit('error', '未找到玩家或房间信息');
            return;
        }
        
        // Initialize room's voice participants if needed
        if (!voiceParticipants[roomId]) {
            voiceParticipants[roomId] = new Map();
        }
        
        // Add player to voice participants
        if (peerId) {
            voiceParticipants[roomId].set(playerId, peerId);
            console.log(`Added player ${playerId} with peer ID ${peerId} to voice chat in room ${roomId}`);
        } else {
            console.warn(`No peer ID provided for player ${playerId} joining voice chat`);
        }
        
        // Join socket to the voice room
        socket.join(`voice:${roomId}`);
        
        // Notify room members of the new participant
        socket.to(roomId).emit('user-joined-voice', {
            userId: playerId,
            peerId: peerId
        });
        
        // Send the current list of voice participants to all clients in the room
        broadcastVoiceParticipants(roomId);
        
        // Also send directly to the joining user to ensure they get it
        socket.emit('voice-users', {
            users: Array.from(voiceParticipants[roomId].keys()),
            peerIds: Object.fromEntries(voiceParticipants[roomId])
        });
        
        console.log(`Player ${playerId} joined voice chat in room ${roomId} with peer ID ${peerId}`);
        console.log('Current voice participants:', Array.from(voiceParticipants[roomId].entries()));
    });

    socket.on('leave-voice', (data) => {
        const { roomId } = data;
        const playerId = currentPlayerId;
        
        console.log('Leave voice request:', { roomId, playerId });
        
        if (voiceParticipants[roomId]) {
            // Remove player from voice participants
            voiceParticipants[roomId].delete(playerId);
            
            // Leave the voice room
            socket.leave(`voice:${roomId}`);
            
            // Notify others that this player left voice
            socket.to(roomId).emit('user-left-voice', {
                userId: playerId
            });
            
            // Update the list of voice participants
            broadcastVoiceParticipants(roomId);
            
            console.log(`Player ${playerId} left voice chat in room ${roomId}`);
            console.log('Current voice participants:', Array.from(voiceParticipants[roomId].entries()));
        }
    });

    // Clean up timeouts when socket disconnects
    socket.on('disconnect', handleDisconnect);

    // Chat message handler
    socket.on('chatMessage', (data: { roomId: string; content: string; type: 'text' | 'emoji'; sender: string }) => {
        console.log('Received chat message:', data);
        const { roomId, content, type, sender } = data;
        const room = gameState.rooms[roomId];
        
        if (!room) {
            console.error('Room not found:', roomId);
            socket.emit('error', '房间不存在');
            return;
        }

        const player = room.players.find(p => p.name === sender);
        if (!player) {
            console.error('Player not found:', sender);
            socket.emit('error', '玩家不存在');
            return;
        }

        // Create message object
        const message = {
            id: Math.random().toString(36).substring(7),
            sender,
            content,
            type,
            timestamp: Date.now()
        };

        console.log('Broadcasting message to room:', message);
        // Broadcast message to all players in the room
        io.to(roomId).emit('chatMessage', message);
    });
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';  // Listen on all interfaces

console.log(`Starting server on ${HOST}:${PORT}`);

// Start HTTP server
httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log('Available network interfaces:');
    const networkInterfaces = require('os').networkInterfaces();
    Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((iface: any) => {
            if (iface.family === 'IPv4') {
                console.log(`  ${interfaceName}: ${iface.address}`);
            }
        });
    });
});
