import { describe, expect, it } from 'vitest';
import { formatShortcut, normalizeVoiceSettings } from './VoiceSettings';

describe('voice settings', () => {
  it('normalizes modes and formats configurable push-to-talk keys', () => {
    expect(normalizeVoiceSettings({ inputMode: 'realtime', pushToTalkCode: 'KeyV' })).toMatchObject({
      inputMode: 'realtime',
      pushToTalkCode: 'KeyV'
    });
    expect(normalizeVoiceSettings({ inputMode: 'invalid' as never }).inputMode).toBe('push-to-talk');
    expect(formatShortcut('KeyV')).toBe('V');
    expect(formatShortcut('Backquote')).toBe('`');
  });
});
