import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { type ChatMessage, type ConversationPhase } from '../../ai/llm/types';

export function useChatAutoScroll(messages: ChatMessage[], phase: ConversationPhase) {
  const [messageList, setMessageList] = useState<HTMLDivElement | null>(null);
  const previousFirstId = useRef<string | undefined>(undefined);
  const previousScrollHeight = useRef(0);
  const messageListRef = useCallback((node: HTMLDivElement | null) => setMessageList(node), []);
  useLayoutEffect(() => {
    if (!messageList) return;
    let frame: number | undefined;
    let timer: number | undefined;
    let unlistenDesktopFocus: (() => void) | undefined;
    let disposed = false;
    const currentFirstId = messages[0]?.id;
    const prepended = Boolean(
      previousFirstId.current &&
        currentFirstId !== previousFirstId.current &&
        messages.some((message) => message.id === previousFirstId.current)
    );
    const scrollToLatest = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      frame = window.requestAnimationFrame(() => {
        messageList.scrollTop = messageList.scrollHeight;
      });
      timer = window.setTimeout(() => {
        messageList.scrollTop = messageList.scrollHeight;
      }, 80);
    };
    if (prepended) {
      messageList.scrollTop += messageList.scrollHeight - previousScrollHeight.current;
    } else {
      scrollToLatest();
    }
    previousFirstId.current = currentFirstId;
    previousScrollHeight.current = messageList.scrollHeight;
    window.addEventListener('focus', scrollToLatest);
    window.addEventListener('resize', scrollToLatest);
    window.addEventListener('pageshow', scrollToLatest);
    document.addEventListener('visibilitychange', scrollToLatest);
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onFocusChanged(({ payload }) => {
            if (payload) scrollToLatest();
          })
        )
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenDesktopFocus = unlisten;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', scrollToLatest);
      window.removeEventListener('resize', scrollToLatest);
      window.removeEventListener('pageshow', scrollToLatest);
      document.removeEventListener('visibilitychange', scrollToLatest);
      unlistenDesktopFocus?.();
    };
  }, [messageList, messages, phase]);
  return messageListRef;
}
