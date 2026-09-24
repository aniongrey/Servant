export type GameId = 'poe2' | string;

export type GameEventType =
  | 'AREA_ENTER'
  | 'PLAYER_DEATH'
  | 'PLAYER_LEVEL_UP'
  | 'CHAT_MESSAGE'
  | 'WHISPER'
  | 'GAME_LOGIN'
  | 'GAME_DISCONNECT'
  | 'LOOT_DROP';

export interface GameEvent {
  type: GameEventType;
  game: GameId;
  timestamp: number;
  source: string;
  priority?: number;
  area?: string;
  player?: string;
  level?: number;
  channel?: string;
  sender?: string;
  message?: string;
  item?: string;
  rarity?: number;
  tier?: string;
  metadata?: Record<string, unknown>;
}

export interface GameEventAdapter {
  readonly id: string;
  readonly game: GameId;
  start(emit: (event: GameEvent) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface GameEventReactionRule {
  id: string;
  game: GameId;
  type: GameEventType;
  eventId: string;
  priority: number;
  item?: string;
  area?: string;
}

export type GameEventReactionRuleInput = Omit<GameEventReactionRule, 'item' | 'area'> & {
  item?: string;
  area?: string;
};
