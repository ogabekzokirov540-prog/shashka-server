export type GameResult = "win" | "loss" | "draw";

export interface UserDoc {
  uid: string;
  displayName: string;
  email: string;
  photoUrl: string;
  bio: string;
  coins: number;
  diamonds: number;
  xp: number;
  level: number;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  totalCoinsWagered: number;
  totalCoinsWon: number;
  currentWinStreak: number;
  longestWinStreak: number;
  rating: number;
  peakRating: number;
  clubId: string;
  clubName: string;
  clubRole: string;
  isOnline: boolean;
  lastSeenAt: number;
  lastDailyClaim: number;
  dailyStreak: number;
  avatarId: string;
  isBot?: boolean;
}
