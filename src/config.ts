// ─────────────────────────────────────────────
//  Shashka — umumiy konstantalar
// ─────────────────────────────────────────────

export const CLUB_MAX_MEMBERS = 30;
export const CHAT_MAX_LENGTH  = 300;
export const BIO_MAX_LENGTH   = 120;
export const ANNOUNCEMENT_MAX = 200;

export const VALID_STAKES = [50, 200, 1000, 5000, 10000];

export const XP_WIN  = 30;
export const XP_LOSS = 10;
export const XP_DRAW = 15;

export const ELO_WIN  =  25;
export const ELO_LOSS = -15;
export const ELO_DRAW =   0;

export const WIN_BASE_BONUS = 20;

export const DAILY_REWARDS = [
  { day: 1, coins: 100,  diamonds: 0  },
  { day: 2, coins: 150,  diamonds: 0  },
  { day: 3, coins: 200,  diamonds: 5  },
  { day: 4, coins: 250,  diamonds: 0  },
  { day: 5, coins: 300,  diamonds: 0  },
  { day: 6, coins: 400,  diamonds: 10 },
  { day: 7, coins: 1000, diamonds: 30 },
];

export const XP_TABLE = [
  0, 100, 250, 450, 700, 1000,
  1350, 1750, 2200, 2700, 3250,
  3850, 4500, 5200, 5950, 6750,
  7600, 8500, 9450, 10450, 11500,
  13000, 14700, 16600, 18700, 21000,
  23500, 26200, 29100, 32200, 35500,
];

export function levelFromXp(xp: number): number {
  for (let i = XP_TABLE.length - 1; i >= 0; i--) {
    if (xp >= XP_TABLE[i]) return i;
  }
  return 0;
}

export function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth()    === d2.getMonth()    &&
    d1.getDate()     === d2.getDate()
  );
}

export function nextMidnight(fromTs: number): number {
  const d = new Date(fromTs);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
