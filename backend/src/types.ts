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
    autoNext: boolean;
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
    currentSmartIndex: number; // Index of the current smart player in the players array
}

export interface Question {
    id: string;
    content: string;
    answer: string;
}

export interface GameState {
    rooms: { [key: string]: Room };
}
