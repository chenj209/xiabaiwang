import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Room, Player, Question } from './types';
import fs from 'fs';
import path from 'path';

const app = express();
const httpServer = createServer(app);

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
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    allowUpgrades: true,
    maxHttpBufferSize: 1e8
});

// Add debug logging
io.engine.on("connection_error", (err) => {
    console.log('Connection error:', err);
});

io.engine.on("connection", (socket) => {
    console.log('New connection:', socket.id);
});

io.engine.on("upgrade", (socket) => {
    console.log('Upgraded to WebSocket:', socket.id);
});

io.engine.on("upgrade_error", (err) => {
    console.log('Upgrade error:', err);
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

    // 创建房间
    socket.on('createRoom', (maxPlayers: number) => {
        const roomId = Math.random().toString(36).substring(7);
        const room: Room = {
            id: roomId,
            players: [],
            maxPlayers,
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
        if (room.players.find(p => p.name === playerName)) {
            socket.emit('error', '该玩家已在房间中');
            return;
        }
        const player: Player = {
            id: socket.id,
            name: playerName,
            role: 'liar', // 默认角色，后续会随机分配
            score: 0,
            hasUsedHonestButton: false
        };
        room.players.push(player);
        socket.join(roomId);
        io.to(roomId).emit('playerJoined', room);
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
    socket.on('vote', (data: { roomId: string, targetId: string }) => {
        const { roomId, targetId } = data;
        const room = gameState.rooms[roomId];
        if (room && room.status === 'voting') {
            const smartPlayer = room.players.find(p => p.role === 'smart');
            if (smartPlayer && smartPlayer.id === socket.id) {
                room.voteResult = { voterId: socket.id, targetId };
                room.status = 'ended';
                io.to(roomId).emit('voteResult', { voterId: socket.id, targetId });
            }
        }
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // 清理玩家数据
        Object.values(gameState.rooms).forEach(room => {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete gameState.rooms[room.id];
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
