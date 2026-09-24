import { describe, expect, it, vi } from 'vitest';
import { createPushToTalkController } from './usePushToTalk';

describe('push-to-talk controller', () => {
  it('interrupts before listening and does not lock while a reply is active', () => {
    const events: string[] = [];
    const controller = createPushToTalkController({
      abort: vi.fn(),
      finishCurrentUtterance: () => true,
      interrupt: () => events.push('interrupt'),
      isSupported: () => true,
      setTranscribing: () => events.push('transcribing'),
      startListening: async () => {
        events.push('listen');
      }
    });

    expect(controller.press(0)).toBe(true);
    expect(events).toEqual(['interrupt', 'listen']);
    expect(controller.release(250)).toBe(true);
    expect(events).toEqual(['interrupt', 'listen', 'transcribing']);
  });

  it('keeps recording after a short press and stops on the next press', () => {
    const interrupt = vi.fn();
    const startListening = vi.fn(async () => undefined);
    const controller = createPushToTalkController({
      abort: vi.fn(),
      finishCurrentUtterance: () => false,
      interrupt,
      isSupported: () => true,
      setTranscribing: vi.fn(),
      startListening
    });

    expect(controller.press(0)).toBe(true);
    expect(controller.release(100)).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(startListening).toHaveBeenCalledTimes(1);

    expect(controller.press(200)).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(startListening).toHaveBeenCalledTimes(1);
  });

  it('stops when a key is held', () => {
    const setTranscribing = vi.fn();
    const controller = createPushToTalkController({
      abort: vi.fn(),
      finishCurrentUtterance: () => true,
      interrupt: vi.fn(),
      isSupported: () => true,
      setTranscribing,
      startListening: async () => undefined
    });

    controller.press(0);
    expect(controller.release(250)).toBe(true);
    expect(setTranscribing).toHaveBeenCalledOnce();
  });
});
