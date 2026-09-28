import { describe, expect, it } from 'vitest';
import fullBody from '../../character/motion/assets/actions/full-body-motion-config.json';
import { ACTION_LABELS, actionLabel, emotionLabel, emotionSoundUrl } from './stagePresentation';

describe('stage presentation labels', () => {
  it('leaves neutral unlabelled so the chip is not rendered', () => {
    expect(emotionLabel('neutral')).toBe('');
    expect(emotionLabel(undefined)).toBe('');
  });

  it('translates every mood the LLM can emit', () => {
    for (const mood of ['happy', 'curious', 'concerned', 'angry', 'sad', 'shy']) {
      expect(emotionLabel(mood)).not.toBe('');
      // 中文名，不能把英文 id 漏到界面上。
      expect(emotionLabel(mood)).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('covers every short action in the motion config', () => {
    // 漏登记就会在对话框上露出英文 id，这条把词表钉死在配置上。
    for (const id of Object.keys(fullBody.emotion)) {
      expect(ACTION_LABELS[id], `missing label for shortAction "${id}"`).toBeTruthy();
      expect(actionLabel(id)).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('falls back to the raw id so an unregistered action is visible during development', () => {
    expect(actionLabel('brand_new_action')).toBe('brand_new_action');
    expect(actionLabel(undefined)).toBe('');
  });

  it('keeps stage emotion sounds disabled', () => {
    expect(emotionSoundUrl('neutral')).toBeNull();
    for (const mood of ['happy', 'curious', 'concerned', 'angry', 'sad', 'shy']) {
      expect(emotionSoundUrl(mood)).toBeNull();
    }
  });
});
