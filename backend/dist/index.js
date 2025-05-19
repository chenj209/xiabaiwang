"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: ["http://localhost:3000", "http://8.148.30.163"],
        methods: ["GET", "POST"],
        credentials: true
    }
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const imagesPath = path_1.default.join(__dirname, '../../images');
app.use('/images', express_1.default.static(imagesPath));
app.use(express_1.default.static(path_1.default.join(__dirname, '../../frontend/build')));
app.get('*', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../../frontend/build', 'index.html'));
});
// 游戏状态
const gameState = {
    rooms: {}
};
// 示例题目
const sampleQuestions = [
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
    socket.on('createRoom', (maxPlayers) => {
        const roomId = Math.random().toString(36).substring(7);
        const room = {
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
    socket.on('joinRoom', (data) => {
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
        const player = {
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
    socket.on('startGame', (roomId) => {
        const room = gameState.rooms[roomId];
        if (room) {
            room.status = 'playing';
            // 随机选择图片题目
            const faceDir = path_1.default.join(__dirname, '../../images/face');
            const backDir = path_1.default.join(__dirname, '../../images/back');
            const files = fs_1.default.readdirSync(faceDir).filter(f => f.endsWith('.png'));
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
    socket.on('useHonestButton', (roomId) => {
        var _a, _b;
        const room = gameState.rooms[roomId];
        if (room && !((_a = room.answerReveal) === null || _a === void 0 ? void 0 : _a.showing)) {
            const player = room.players.find(p => p.id === socket.id);
            if (player && player.role === 'honest' && !player.hasUsedHonestButton) {
                player.hasUsedHonestButton = true;
                const endTime = Date.now() + 30000;
                room.answerReveal = { showing: true, endTime };
                // 给老实人自己发带答案
                socket.emit('answerReveal', { showing: true, endTime, answer: (_b = room.currentQuestion) === null || _b === void 0 ? void 0 : _b.answer });
                // 给其他人发不带答案
                room.players.forEach(p => {
                    if (p.id !== socket.id) {
                        io.to(p.id).emit('answerReveal', { showing: true, endTime });
                    }
                });
                setTimeout(() => {
                    var _a;
                    if ((_a = room.answerReveal) === null || _a === void 0 ? void 0 : _a.showing) {
                        room.answerReveal = { showing: false, endTime: 0 };
                        io.to(roomId).emit('answerReveal', { showing: false, endTime: 0 });
                        io.to(roomId).emit('playerJoined', room);
                    }
                }, 30000);
            }
        }
    });
    // 进入投票环节（只有大聪明可以发起）
    socket.on('startVoting', (roomId) => {
        var _a;
        const room = gameState.rooms[roomId];
        if (room && room.status === 'playing' && !((_a = room.answerReveal) === null || _a === void 0 ? void 0 : _a.showing)) {
            const honestPlayer = room.players.find(p => p.role === 'honest');
            if (!honestPlayer || !honestPlayer.hasUsedHonestButton)
                return; // 老实人没用过按钮不能投票
            const smartPlayer = room.players.find(p => p.role === 'smart');
            if (smartPlayer && smartPlayer.id === socket.id) {
                room.status = 'voting';
                io.to(roomId).emit('votingStarted', { room });
            }
        }
    });
    // 大聪明投票
    socket.on('vote', (data) => {
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
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
