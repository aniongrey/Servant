import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The clear-chat button plus its confirmation. Clearing the transcript is
 * destructive and irreversible from the UI, so it never happens on a single
 * click. The copy has to say what is deleted *and* what survives: "聊天记录"
 * (the lancedb `messages` table) and "记忆" (the `memories` table) are separate
 * stores in this app, and users read any clear button as "forget me".
 */
export function ClearChatConfirm({ onConfirm }: { onConfirm(): void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="wechatClearChat" ref={rootRef} onPointerDown={(event) => event.stopPropagation()}>
      <button
        aria-controls="chat-clear-confirm"
        aria-expanded={open}
        className="wechatIconButton"
        onClick={() => setOpen((current) => !current)}
        title="清空聊天"
        type="button"
      >
        <Trash2 size={16} />
      </button>
      {open ? (
        <div
          aria-label="清空聊天记录"
          className="wechatClearConfirm"
          id="chat-clear-confirm"
          role="alertdialog"
        >
          <strong>清空全部聊天记录？</strong>
          <p>仅清空聊天上下文：lancedb 里保存的全部聊天记录会被删除，之后模型不再记得这段对话。</p>
          <p className="wechatClearConfirmKeep">长期记忆（记忆库）保留。</p>
          <div className="wechatClearConfirmActions">
            <button onClick={() => setOpen(false)} type="button">
              取消
            </button>
            <button
              className="danger"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              type="button"
            >
              确认清空
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
