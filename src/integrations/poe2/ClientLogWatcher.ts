import type { GameEvent } from '../../event/events/game/types';
import { POE2EventParser } from './POE2EventParser';

export interface TextFileTailReader {
  getSize(): Promise<number>;
  readFrom(offset: number): Promise<{ text: string; nextOffset: number }>;
}

export interface ClientLogWatcherOptions {
  pollIntervalMs?: number;
  startAtEnd?: boolean;
  parser?: POE2EventParser;
}

export class ClientLogWatcher {
  private readonly parser: POE2EventParser;
  private readonly pollIntervalMs: number;
  private readonly startAtEnd: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private offset = 0;
  private pending = '';
  private emit?: (event: GameEvent) => void;

  constructor(private readonly reader: TextFileTailReader, options: ClientLogWatcherOptions = {}) {
    this.parser = options.parser ?? new POE2EventParser();
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.startAtEnd = options.startAtEnd ?? true;
  }

  async start(emit: (event: GameEvent) => void): Promise<void> {
    if (this.timer) {
      return;
    }

    this.emit = emit;
    this.offset = this.startAtEnd ? await this.reader.getSize() : 0;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    await this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.emit = undefined;
  }

  async poll(): Promise<void> {
    const size = await this.reader.getSize();
    if (size < this.offset) {
      this.offset = 0;
      this.pending = '';
    }

    if (size === this.offset) {
      return;
    }

    const next = await this.reader.readFrom(this.offset);
    this.offset = next.nextOffset;
    this.consume(next.text);
  }

  private consume(text: string): void {
    const combined = this.pending + text;
    const lines = combined.split(/\r?\n/);
    this.pending = lines.pop() ?? '';

    for (const line of lines) {
      const event = this.parser.parseLine(line);
      if (event) {
        this.emit?.(event);
      }
    }
  }
}

export async function findClientLogPath(
  candidates: string[],
  exists: (path: string) => boolean | Promise<boolean>
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function defaultPOE2ClientLogCandidates(home = ''): string[] {
  const roots = [
    'C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2/logs/Client.txt',
    'C:/Program Files/Steam/steamapps/common/Path of Exile 2/logs/Client.txt',
    'C:/Program Files/Grinding Gear Games/Path of Exile 2/logs/Client.txt'
  ];

  return home
    ? [`${home.replace(/\\/g, '/')}/Documents/My Games/Path of Exile 2/logs/Client.txt`, ...roots]
    : roots;
}
