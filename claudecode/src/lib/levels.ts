export interface Level {
  key: string;
  name: string;
  min: number;
  description: string;
}

export const LEVELS: Level[] = [
  { key: 'beginner', name: 'Night Beginner', min: 1, description: 'Primeira avaliação publicada.' },
  { key: 'explorer', name: 'Night Explorer', min: 5, description: '5 avaliações publicadas.' },
  { key: 'expert', name: 'Night Expert', min: 15, description: '15 avaliações publicadas.' },
  { key: 'legend', name: 'Night Legend', min: 30, description: '30 avaliações publicadas.' },
];

/** Nível atual calculado automaticamente pela quantidade de avaliações. */
export function levelFor(reviewCount: number): Level | null {
  let current: Level | null = null;
  for (const l of LEVELS) if (reviewCount >= l.min) current = l;
  return current;
}

export function nextLevel(reviewCount: number): Level | null {
  return LEVELS.find((l) => reviewCount < l.min) ?? null;
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  unlocked: boolean;
}

export function achievementsFor(stats: { review_count: number; likes_received: number; cities: number; favorites: number }): Achievement[] {
  return [
    ...LEVELS.map((l) => ({ key: l.key, name: l.name, description: l.description, unlocked: stats.review_count >= l.min })),
    { key: 'liked', name: 'Voz da noite', description: '25 curtidas recebidas.', unlocked: stats.likes_received >= 25 },
    { key: 'traveler', name: 'Night Traveler', description: 'Avaliou casas em 3 cidades.', unlocked: stats.cities >= 3 },
    { key: 'curator', name: 'Curador', description: '10 lugares favoritados.', unlocked: stats.favorites >= 10 },
  ];
}
