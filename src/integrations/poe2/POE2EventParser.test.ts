import { describe, expect, it } from 'vitest';
import { POE2EventParser } from './POE2EventParser';

describe('POE2EventParser', () => {
  const parser = new POE2EventParser();

  it('parses area enter lines', () => {
    const event = parser.parseLine(
      '2026/08/31 20:12:00 123 INFO Client 123 [INFO Client] You have entered Clearfell.'
    );

    expect(event).toMatchObject({
      type: 'AREA_ENTER',
      game: 'poe2',
      source: 'client_log',
      area: 'Clearfell'
    });
  });

  it('parses death and level events', () => {
    expect(
      parser.parseLine('2026/08/31 20:12:01 123 INFO Client 123 [INFO Client] Servant has been slain.')
    ).toMatchObject({
      type: 'PLAYER_DEATH',
      player: 'Servant'
    });
    expect(
      parser.parseLine('2026/08/31 20:12:02 123 INFO Client 123 [INFO Client] Servant is now level 42')
    ).toMatchObject({
      type: 'PLAYER_LEVEL_UP',
      player: 'Servant',
      level: 42
    });
  });

  it('parses chat and whisper messages', () => {
    expect(
      parser.parseLine('2026/08/31 20:12:03 123 INFO Client 123 [INFO Client] @From Trader: hi')
    ).toMatchObject({
      type: 'WHISPER',
      channel: 'whisper',
      sender: 'Trader',
      message: 'hi'
    });
    expect(
      parser.parseLine('2026/08/31 20:12:04 123 INFO Client 123 [INFO Client] # GlobalUser: hello')
    ).toMatchObject({
      type: 'CHAT_MESSAGE',
      channel: 'global',
      sender: 'GlobalUser',
      message: 'hello'
    });
  });
});
