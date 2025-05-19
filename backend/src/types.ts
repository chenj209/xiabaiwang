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
    status: 'waiting' | 'playing' | 'ended';
    currentQuestion?: Question;
    round: number;
}

export interface Question {
    id: string;
    content: string;
    answer: string;
}

export interface GameState {
    rooms: { [key: string]: Room };
}
