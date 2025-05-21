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
    status: 'waiting' | 'playing' | 'voting' | 'ended';
    currentQuestion?: Question;
    round: number;
    totalRounds: number;
    voteResult?: { 
        voterId: string; 
        honestTargetId: string;
        liarTargetId?: string;
    };
    answerReveal?: { showing: boolean; endTime: number };
}

export interface Question {
    id: string;
    content: string;
    answer: string;
}

export interface GameState {
    rooms: { [key: string]: Room };
}
