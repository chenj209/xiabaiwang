import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Room, Player, Question } from './types';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

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
            // 随机选择题目
            const randomQuestion = sampleQuestions[Math.floor(Math.random() * sampleQuestions.length)];
            room.currentQuestion = randomQuestion;
            
            // 随机分配角色
            const players = room.players;
            const smartIndex = Math.floor(Math.random() * players.length);
            const honestIndex = (smartIndex + 1) % players.length;
            
            players[smartIndex].role = 'smart';
            players[honestIndex].role = 'honest';
            
            io.to(roomId).emit('gameStarted', {
                room,
                question: randomQuestion
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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
