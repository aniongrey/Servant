export type LiveLogCategory =
  | 'LIVE_RAW'
  | 'LIVE_FILTER'
  | 'LIVE_PRIORITY'
  | 'LIVE_QUEUE'
  | 'LIVE_RESPONSE'
  | 'LIVE_ERROR';

export interface LiveLogger {
  log(category: LiveLogCategory, message: string, details?: unknown): void;
}

export const consoleLiveLogger: LiveLogger = {
  log(category, message, details) {
    if (details === undefined) {
      console.debug(`[${category}] ${message}`);
      return;
    }
    console.debug(`[${category}] ${message}`, details);
  }
};

export const silentLiveLogger: LiveLogger = {
  log() {}
};
