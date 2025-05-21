import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Room, Player, Question } from './types';
import fs from 'fs';
import path from 'path';

const app = express();
const httpServer = createServer(app);

// Add player session store
const playerSessions: { [key: string]: { playerId: string, roomId: string, playerName: string } } = {};

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
    }
};

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const io = new Server(httpServer, {
    cors: {
        origin: ["http://8.148.30.163", "http://8.148.30.163:3001", "http://localhost:3000"],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"]
    },
    transports: ['polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    allowUpgrades: false,  // Disable upgrades for now
    maxHttpBufferSize: 1e8
});

// Add debug logging
io.engine.on("connection_error", (err) => {
    console.log('Connection error:', err);
});

io.engine.on("connection", (socket) => {
    console.log('New connection:', socket.id);
});

// Configure CORS for Express
app.use(cors({
    origin: ["http://8.148.30.163", "http://8.148.30.163:3001", "http://localhost:3000"],
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

// Socket.IO 连接处理
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

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
    socket.on('createRoom', (data: { maxPlayers: number, totalRounds: number, pointsToWin: number }) => {
        const roomId = Math.random().toString(36).substring(7);
        const room: Room = {
            id: roomId,
            players: [],
            maxPlayers: data.maxPlayers,
            totalRounds: data.totalRounds,
            pointsToWin: data.pointsToWin,
            status: 'waiting',
            round: 0
        };
        gameState.rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { id: roomId, room });
    });

    // 加入房间
    socket.on('joinRoom', (data: { roomId: string, playerName: string }) => {
        const { roomId, playerName } = data;
        const room = gameState.rooms[roomId];
        
        if (!room) {
            socket.emit('error', '房间不存在');
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            socket.emit('error', '房间已满');
            return;
        }

        // Check if player already exists in the room
        const existingPlayer = room.players.find(p => p.name === playerName);
        if (existingPlayer) {
            // Update socket ID for the existing player
            existingPlayer.id = socket.id;
            socket.join(roomId);
            socket.emit('playerId', playerName);
            io.to(roomId).emit('playerJoined', room);
            return;
        }

        // Create new player
        const player: Player = {
            id: socket.id,
            name: playerName,
            role: 'liar',
            score: 0,
            hasUsedHonestButton: false
        };

        // Add player to room
        room.players.push(player);
        socket.join(roomId);
        socket.emit('playerId', playerName);
        io.to(roomId).emit('playerJoined', room);
    });

    // 离开游戏
    socket.on('leaveGame', (data: { roomId: string, playerId: string }) => {
        const { roomId, playerId } = data;
        const room = gameState.rooms[roomId];
        
        if (room) {
            // Remove player from room
            room.players = room.players.filter(p => p.id !== playerId);
            
            // Remove player session
            delete playerSessions[playerId];
            
            // If room is empty, delete it
            if (room.players.length === 0) {
                delete gameState.rooms[roomId];
            } else {
                // Notify other players
                io.to(roomId).emit('playerJoined', room);
            }
        }
    });

    // 开始游戏
    socket.on('startGame', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room) {
            room.status = 'playing';
            // 随机选择图片题目
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
            // 随机分配角色
            const players = room.players;
            players.forEach(p => p.role = 'liar');
            const smartIndex = Math.floor(Math.random() * players.length);
            let honestIndex = Math.floor(Math.random() * players.length);
            while (honestIndex === smartIndex && players.length > 1) {
                honestIndex = Math.floor(Math.random() * players.length);
            }
            players[smartIndex].role = 'smart';
            players[honestIndex].role = 'honest';
            io.to(roomId).emit('gameStarted', {
                room,
                question
            });
        }
    });

    // 使用老实人按钮
    socket.on('useHonestButton', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room && !room.answerReveal?.showing) {
            const player = room.players.find(p => p.id === socket.id);
            if (player && player.role === 'honest' && !player.hasUsedHonestButton) {
                player.hasUsedHonestButton = true;
                const endTime = Date.now() + 30000;
                room.answerReveal = { showing: true, endTime };
                // 给老实人自己发带答案
                socket.emit('answerReveal', { showing: true, endTime, answer: room.currentQuestion?.answer });
                // 给其他人发不带答案
                room.players.forEach(p => {
                    if (p.id !== socket.id) {
                        io.to(p.id).emit('answerReveal', { showing: true, endTime });
                    }
                });
                setTimeout(() => {
                    if (room.answerReveal?.showing) {
                        room.answerReveal = { showing: false, endTime: 0 };
                        io.to(roomId).emit('answerReveal', { showing: false, endTime: 0 });
                        io.to(roomId).emit('playerJoined', room);
                    }
                }, 30000);
            }
        }
    });

    // 进入投票环节（只有大聪明可以发起）
    socket.on('startVoting', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room && room.status === 'playing' && !room.answerReveal?.showing) {
            const honestPlayer = room.players.find(p => p.role === 'honest');
            if (!honestPlayer || !honestPlayer.hasUsedHonestButton) return; // 老实人没用过按钮不能投票
            const smartPlayer = room.players.find(p => p.role === 'smart');
            if (smartPlayer && smartPlayer.id === socket.id) {
                room.status = 'voting';
                io.to(roomId).emit('votingStarted', { room });
            }
        }
    });

    // 大聪明投票
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
            }
        }
    });

    // 开始下一局游戏
    socket.on('nextGame', (roomId: string) => {
        const room = gameState.rooms[roomId];
        if (room) {
            // 重置房间状态
            room.status = 'playing';
            room.round += 1;
            room.voteResult = undefined;
            room.answerReveal = undefined;

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

            // 重新随机分配角色
            const players = room.players;
            players.forEach(p => p.role = 'liar');
            const smartIndex = Math.floor(Math.random() * players.length);
            let honestIndex = Math.floor(Math.random() * players.length);
            while (honestIndex === smartIndex && players.length > 1) {
                honestIndex = Math.floor(Math.random() * players.length);
            }
            players[smartIndex].role = 'smart';
            players[honestIndex].role = 'honest';

            // 通知所有玩家新游戏开始
            io.to(roomId).emit('nextGameStarted', {
                room,
                question
            });
        }
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Don't remove player data on disconnect, only update socket ID
        Object.values(gameState.rooms).forEach(room => {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.id = 'disconnected';
            }
        });
    });
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';  // Listen on all interfaces

// Add more detailed startup logging
console.log(`Starting server on ${HOST}:${PORT}`);
console.log('CORS origins:', ["http://8.148.30.163", "http://8.148.30.163:3001", "http://localhost:3000"]);

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
