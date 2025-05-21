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
// Add player session store
const playerSessions = {};
// Add closed rooms tracking
const closedRooms = {};
// Add efficient room data caching
const roomCache = new Map();
// Add function to remove player from all rooms
const removePlayerFromAllRooms = (playerId) => {
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
const io = new socket_io_1.Server(httpServer, {
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
    allowUpgrades: false, // Disable upgrades for now
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
app.use((0, cors_1.default)({
    origin: ["http://8.148.30.163", "http://8.148.30.163:3001", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
}));
// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});
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
// Add cleanup for old closed rooms
setInterval(() => {
    const now = Date.now();
    Object.entries(closedRooms).forEach(([roomId, data]) => {
        if (now - data.closedAt > 1000 * 60 * 60) { // Remove after 1 hour
            delete closedRooms[roomId];
        }
    });
}, 1000 * 60 * 5); // Check every 5 minutes
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
    }
    catch (error) {
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
const imageCache = new Map();
const loadImages = () => {
    const faceDir = path_1.default.join(__dirname, '../../images/face');
    const backDir = path_1.default.join(__dirname, '../../images/back');
    try {
        const files = fs_1.default.readdirSync(faceDir).filter(f => f.endsWith('.png'));
        files.forEach(file => {
            imageCache.set(file, {
                path: file,
                lastAccess: Date.now()
            });
        });
    }
    catch (error) {
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
    // Handle reconnection
    socket.on('reconnect', (data) => {
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
    socket.on('createRoom', (data) => {
        console.log('Creating room with data:', data);
        const roomId = Math.random().toString(36).substring(7);
        const room = {
            id: roomId,
            players: [],
            maxPlayers: data.maxPlayers,
            totalRounds: data.totalRounds,
            pointsToWin: data.pointsToWin,
            answerViewTime: data.answerViewTime,
            status: 'waiting',
            round: 0
        };
        gameState.rooms[roomId] = room;
        socket.join(roomId);
        console.log('Room created:', room);
        socket.emit('roomCreated', { id: roomId, room });
        broadcastRoomList(); // Broadcast updated room list
    });
    // 加入房间
    socket.on('joinRoom', (data) => {
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
            broadcastRoomList();
            return;
        }
        // Add new player
        const player = {
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
    socket.on('leaveGame', (data) => {
        const { roomId, playerId } = data;
        const room = gameState.rooms[roomId];
        if (room) {
            const isCreator = playerId === room.players[0]?.id;
            room.players = room.players.filter(p => p.id !== playerId);
            if (isCreator || room.players.length === 0) {
                // Store closed room state
                closedRooms[roomId] = {
                    message: isCreator ? '房主已离开，房间已关闭' : '所有玩家已离开，房间已关闭',
                    closedAt: Date.now()
                };
                // Delete room and notify players
                delete gameState.rooms[roomId];
                io.to(roomId).emit('roomClosed', {
                    message: closedRooms[roomId].message,
                    shouldRedirect: isCreator
                });
                socket.leave(roomId);
                cleanupRoom(roomId);
            }
            else {
                // Notify remaining players
                io.to(roomId).emit('playerJoined', room);
            }
            // Remove player session
            delete playerSessions[playerId];
            broadcastRoomList();
        }
    });
    // Add timeout for 老实人
    let honestPlayerTimeouts = {};
    // Add honest player button handler
    socket.on('useHonestButton', (roomId) => {
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
    const setupHonestPlayerTimeout = (roomId) => {
        const room = gameState.rooms[roomId];
        if (!room)
            return;
        const honestPlayer = room.players.find(p => p.role === 'honest');
        if (!honestPlayer)
            return;
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
    // Modify startGame to use the new timeout setup
    socket.on('startGame', (roomId) => {
        const room = gameState.rooms[roomId];
        if (!room || room.status !== 'waiting')
            return;
        room.status = 'playing';
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
        // Optimize role assignment
        const playerCount = room.players.length;
        const smartIndex = Math.floor(Math.random() * playerCount);
        let honestIndex;
        do {
            honestIndex = Math.floor(Math.random() * playerCount);
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
    const cleanupRoom = (roomId) => {
        if (honestPlayerTimeouts[roomId]) {
            clearTimeout(honestPlayerTimeouts[roomId]);
            delete honestPlayerTimeouts[roomId];
        }
    };
    // 进入投票环节（只有大聪明可以发起）
    socket.on('startVoting', (roomId) => {
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
    // 大聪明投票
    socket.on('vote', (data) => {
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
                    const winner = room.players.reduce((prev, current) => (current.score > prev.score) ? current : prev);
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
    // 开始下一局游戏
    socket.on('nextGame', (roomId) => {
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
        }
        catch (error) {
            console.error('Error in getRooms:', error);
            socket.emit('error', '获取房间列表失败');
        }
    });
    // Clean up timeouts when socket disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up any rooms where this socket was the creator
        Object.entries(gameState.rooms).forEach(([roomId, room]) => {
            if (room.players[0]?.id === socket.id) {
                // Store closed room state
                closedRooms[roomId] = {
                    message: '房主已断开连接，房间已关闭',
                    closedAt: Date.now()
                };
                delete gameState.rooms[roomId];
                io.to(roomId).emit('roomClosed', {
                    message: closedRooms[roomId].message,
                    shouldRedirect: true
                });
                cleanupRoom(roomId);
                broadcastRoomList();
            }
            else {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    room.players = room.players.filter(p => p.id !== socket.id);
                    if (room.players.length === 0) {
                        delete gameState.rooms[roomId];
                        cleanupRoom(roomId);
                    }
                    else {
                        io.to(roomId).emit('playerJoined', room);
                    }
                    broadcastRoomList();
                }
            }
        });
    });
    // Move chat message handler outside of disconnect handler
    socket.on('chatMessage', (data) => {
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
const HOST = '0.0.0.0'; // Listen on all interfaces
// Add more detailed startup logging
console.log(`Starting server on ${HOST}:${PORT}`);
console.log('CORS origins:', ["http://8.148.30.163", "http://8.148.30.163:3001", "http://localhost:3000"]);
httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log('Available network interfaces:');
    const networkInterfaces = require('os').networkInterfaces();
    Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((iface) => {
            if (iface.family === 'IPv4') {
                console.log(`  ${interfaceName}: ${iface.address}`);
            }
        });
    });
});
