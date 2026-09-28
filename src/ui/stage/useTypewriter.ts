import { useEffect, useRef, useState } from 'react';
import { typewriterStepMs, typewriterTotalMs } from './typewriterTiming';

/**
 * Galgame 对话框的打字机。
 *
 * 关键约束：**揭示速度必须由「这句话说完要多长时间」反推，而不是固定每字多少毫秒。**
 * 语音合成（尤其 GPT-SoVITS）时长差别很大，固定速度会出现两种坏情况——声音已经
 * 说完了字还在爬，或者声音还在念字早早就铺完了。所以这里接受一个 `durationMs`
 * （由调用方给出这一段的预计语音时长），把整句话均摊到这段时间上，并给每字一个
 * 上下限，避免超短句闪一下、超长句慢如蜗牛。
 *
 * 具体节奏算法在 `typewriterTiming.ts`——多人对话窗口那边没有打字机，却要判断
 * 「这一轮铺完了没有」，两处必须用同一份时长才算得对。
 *
 * `instant` 用于「不想要动画」的场合（历史记录回看、减少动态偏好），直接把字全铺上。
 */

export interface TypewriterState {
  /** 已经揭示出来的文字（始终是原文的前缀）。 */
  shown: string;
  /** 是否已经铺完全文。 */
  done: boolean;
}

export function useTypewriter(
  text: string,
  options: { durationMs?: number; instant?: boolean; enabled?: boolean } = {}
): TypewriterState & { complete(): void } {
  const { durationMs = 0, instant = false, enabled = true } = options;
  const [state, setState] = useState<TypewriterState>(() => ({
    shown: instant || !enabled ? text : '',
    done: instant || !enabled
  }));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (instant || !enabled || !text || prefersReducedMotion()) {
      setState({ shown: text, done: true });
      return;
    }
    const characters = Array.from(text);
    let index = 0;
    setState({ shown: '', done: false });
    const tick = () => {
      index += 1;
      if (index >= characters.length) {
        setState({ shown: text, done: true });
        return;
      }
      setState({ shown: characters.slice(0, index).join(''), done: false });
      timer.current = setTimeout(tick, typewriterStepMs(text, index - 1, durationMs));
    };
    timer.current = setTimeout(tick, typewriterStepMs(text, 0, durationMs));
    return () => clearTimeout(timer.current);
  }, [durationMs, enabled, instant, text]);

  return {
    ...state,
    complete() {
      clearTimeout(timer.current);
      setState({ shown: text, done: true });
    }
  };
}

/** 整段铺完要多久；调用方拿它排「下一句什么时候开始」。 */
export { typewriterTotalMs };

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
