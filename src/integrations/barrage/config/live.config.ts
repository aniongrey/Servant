import type { FilterRule } from '../filter/LiveContentFilter';

export interface LiveConfig {
  enabled: boolean;
  barrageGrab: {
    url: string;
    reconnect: boolean;
    reconnectDelayMs: number;
    maxReconnectDelayMs: number;
  };
  queue: {
    highThreshold: number;
    normalThreshold: number;
    maxHighSize: number;
    maxNormalSize: number;
    maxLowSize: number;
  };
  controller: {
    tickIntervalMs: number;
    responseCooldownMs: number;
  };
  aggregation: {
    windowMs: number;
  };
  filter: {
    spamWindowMs: number;
    spamMaxMessages: number;
    lowValueMessages: string[];
    rules: FilterRule[];
  };
  ttl: {
    danmakuMs: number;
    highDanmakuMs: number;
    questionMs: number;
    giftMs: number;
    followMs: number;
    defaultMs: number;
  };
  petNames: string[];
  highValueGiftValue: number;
}

export const liveConfig: LiveConfig = {
  enabled: true,
  barrageGrab: {
    url: 'ws://127.0.0.1:8888',
    reconnect: true,
    reconnectDelayMs: 3000,
    maxReconnectDelayMs: 30000
  },
  queue: {
    highThreshold: 80,
    normalThreshold: 40,
    maxHighSize: 100,
    maxNormalSize: 200,
    maxLowSize: 500
  },
  controller: {
    tickIntervalMs: 200,
    responseCooldownMs: 5000
  },
  aggregation: {
    windowMs: 3000
  },
  filter: {
    spamWindowMs: 3000,
    spamMaxMessages: 5,
    lowValueMessages: ['666', '哈哈', '哈哈哈', '来了', '好耶', '牛逼'],
    rules: []
  },
  ttl: {
    danmakuMs: 8000,
    highDanmakuMs: 15000,
    questionMs: 20000,
    giftMs: 30000,
    followMs: 15000,
    defaultMs: 8000
  },
  petNames: ['白', '小白', '白白'],
  highValueGiftValue: 100
};
