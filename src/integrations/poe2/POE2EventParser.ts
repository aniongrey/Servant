import type { GameEvent } from '../../event/events/game/types';

export type POE2LogEventType = Extract<
  GameEvent['type'],
  | 'AREA_ENTER'
  | 'PLAYER_DEATH'
  | 'PLAYER_LEVEL_UP'
  | 'CHAT_MESSAGE'
  | 'WHISPER'
  | 'GAME_LOGIN'
  | 'GAME_DISCONNECT'
>;

export class POE2EventParser {
  parseLine(line: string): GameEvent | undefined {
    const timestamp = parseClientTimestamp(line) ?? Date.now();
    const message = stripClientPrefix(line).trim();
    if (!message) {
      return undefined;
    }

    const area = parseAreaEnter(message);
    if (area) {
      return this.event('AREA_ENTER', timestamp, { area });
    }

    const death = parsePlayerDeath(message);
    if (death) {
      return this.event('PLAYER_DEATH', timestamp, { player: death });
    }

    const level = parseLevelUp(message);
    if (level) {
      return this.event('PLAYER_LEVEL_UP', timestamp, level);
    }

    const whisper = parseWhisper(message);
    if (whisper) {
      return this.event('WHISPER', timestamp, whisper);
    }

    const chat = parseChat(message);
    if (chat) {
      return this.event('CHAT_MESSAGE', timestamp, chat);
    }

    if (/connected to|login/i.test(message)) {
      return this.event('GAME_LOGIN', timestamp);
    }

    if (/disconnected|abnormal disconnect|failed to connect/i.test(message)) {
      return this.event('GAME_DISCONNECT', timestamp);
    }

    return undefined;
  }

  parseLines(text: string): GameEvent[] {
    return text
      .split(/\r?\n/)
      .map((line) => this.parseLine(line))
      .filter((event): event is GameEvent => event !== undefined);
  }

  private event(type: POE2LogEventType, timestamp: number, partial: Partial<GameEvent> = {}): GameEvent {
    return {
      type,
      game: 'poe2',
      timestamp,
      source: 'client_log',
      ...partial
    };
  }
}

function parseClientTimestamp(line: string): number | undefined {
  const match = line.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime();
}

function stripClientPrefix(line: string): string {
  return line.replace(/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}.*?\]\s*/, '');
}

function parseAreaEnter(message: string): string | undefined {
  const match = message.match(/(?:You have entered|Entering area)\s+(.+?)\.?$/i);
  return match?.[1]?.trim();
}

function parsePlayerDeath(message: string): string | undefined {
  const match = message.match(/^(?:(.+?)\s+)?has been slain\.?$/i);
  if (!match) {
    return undefined;
  }
  return match[1]?.trim() || 'player';
}

function parseLevelUp(message: string): Partial<GameEvent> | undefined {
  const match = message.match(/^(?:(.+?)\s+)?(?:is now level|has reached level)\s+(\d+)/i);
  if (!match) {
    return undefined;
  }

  return {
    player: match[1]?.trim() || 'player',
    level: Number(match[2])
  };
}

function parseWhisper(message: string): Partial<GameEvent> | undefined {
  const from = message.match(/^@From\s+(.+?):\s+(.+)$/i);
  if (from) {
    return {
      channel: 'whisper',
      sender: from[1].trim(),
      message: from[2].trim()
    };
  }

  const to = message.match(/^@To\s+(.+?):\s+(.+)$/i);
  if (to) {
    return {
      channel: 'whisper',
      sender: to[1].trim(),
      message: to[2].trim()
    };
  }

  return undefined;
}

function parseChat(message: string): Partial<GameEvent> | undefined {
  const match = message.match(/^([#$%&])\s*(.+?):\s+(.+)$/);
  if (!match) {
    return undefined;
  }

  return {
    channel: channelFromPrefix(match[1]),
    sender: match[2].trim(),
    message: match[3].trim()
  };
}

function channelFromPrefix(prefix: string): string {
  switch (prefix) {
    case '#':
      return 'global';
    case '$':
      return 'trade';
    case '%':
      return 'party';
    case '&':
      return 'guild';
    default:
      return 'chat';
  }
}
