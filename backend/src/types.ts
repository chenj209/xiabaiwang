export interface Player {
    id: string;
    name: string;
    role: 'smart' | 'honest' | 'liar';
    score: number;
    hasUsedHonestButton: boolean;
}

export interface Room {
    id: string;
    players: Player[];
    maxPlayers: number;
    status: 'waiting' | 'playing' | 'voting' | 'ended' | 'completed';
    currentQuestion?: Question;
    round: number;
    totalRounds: number;
    pointsToWin: number;
    answerViewTime: number; // in seconds
    voteResult?: { 
        voterId: string; 
        honestTargetId: string;
        liarTargetId?: string;
    };
    answerReveal?: { showing: boolean; endTime: number };
    gameWinner?: Player;
}

export interface Question {
    id: string;
    content: string;
    answer: string;
}

export interface GameState {
    rooms: { [key: string]: Room };
}
