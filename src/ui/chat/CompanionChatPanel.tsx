import { VoiceInputControls, VoiceMicButton } from '../voice/VoiceInputControls';
import {
  Bot,
  Maximize2,
  Minus,
  Search,
  Send,
  Square,
  User
} from 'lucide-react';
import { hideCurrentDesktopWindow, isTauriDesktop } from '../../desktop/tauri/navigation';
import { soulNeedLabels } from '../../soul';
import { type CompanionChatPanelProps } from './chatTypes';
import { useChatWindow } from './useChatWindow';
import { useCompanionConversation } from './useCompanionConversation';
import { useChatAutoScroll } from './useChatAutoScroll';
import { phaseLabel, formatDuration } from './chatPresentation';
import { ChatSettingsMenu } from './ChatSettingsMenu';
import { ClearChatConfirm } from './ClearChatConfirm';

export function CompanionChatPanel(props: CompanionChatPanelProps) {
  const { windowState, setWindowState, panelRef, startDragging } = useChatWindow();
  const {
    activeLlmConfig,
    updateLlmConfig,
    voice,
    messages,
    personality,
    currentNeed,
    characterSkill,
    characterSkillError,
    input,
    setInput,
    phase,
    error,
    models,
    llmOnline,
    realtimeState,
    webSearchEnabled,
    setWebSearchEnabled,
    canInterruptReply,
    historyLoading,
    hasOlderMessages,
    historyNotice,
    revealHistoryEnd,
    loadOlderMessages,
    lastVoiceTimings,
    llmFirstSpeechMs,
    speechPlaybackStartMs,
    submit,
    interruptReply,
    clearMessages
  } = useCompanionConversation(props);
  const messageListRef = useChatAutoScroll(messages, phase);
  const replyBusy = phase === 'thinking' || phase === 'typing';

  if (!characterSkill)
    return (
      <section className="wechatChat" aria-label="AI companion chat">
        {/* Distinguish a real failure from slow loading. Returning the placeholder
            unconditionally turned every card-load error into an endless spinner. */}
        {characterSkillError ? (
          <p className="wechatEmpty" data-error="true" role="alert">
            角色卡读取失败：{characterSkillError}
          </p>
        ) : (
          <p className="wechatEmpty">正在从服务端加载角色卡…</p>
        )}
      </section>
    );

  return (
    <section
      className="wechatChat"
      aria-label="AI companion chat"
      data-minimized={windowState.minimized}
      ref={panelRef}
      style={
        windowState.x === null || windowState.y === null
          ? undefined
          : { left: windowState.x, right: 'auto', top: windowState.y }
      }
    >
      <header className="wechatHeader" onPointerDown={startDragging}>
        <div className="wechatAvatar">
          <Bot size={20} />
        </div>
        <div>
          <strong>{characterSkill.config.displayName}</strong>
          <small>
            <i data-online={realtimeState === 'connected'} title={`WebSocket：${realtimeState}`} />
            {realtimeState === 'connected'
              ? '推送已连接'
              : realtimeState === 'connecting'
              ? '推送连接中'
              : '推送已断开'}
            {' · '}
            {llmOnline ? `${activeLlmConfig.model}` : 'LLM offline'}
          </small>
        </div>
        <div className="wechatHeaderActions">
          <ChatSettingsMenu />
          <ClearChatConfirm onConfirm={clearMessages} />
          <button
            className="wechatIconButton"
            onClick={() => {
              if (isTauriDesktop()) {
                void hideCurrentDesktopWindow();
                return;
              }
              setWindowState((current) => ({ ...current, minimized: !current.minimized }));
            }}
            title={
              isTauriDesktop() ? '隐藏聊天窗口' : windowState.minimized ? '展开聊天窗口' : '最小化聊天窗口'
            }
            type="button"
          >
            {isTauriDesktop() ? (
              <Minus size={16} />
            ) : windowState.minimized ? (
              <Maximize2 size={16} />
            ) : (
              <Minus size={16} />
            )}
          </button>
        </div>
      </header>

      {!windowState.minimized ? (
        <>
          <div className="personalityStrip">
            <span>状态：{personality.mood}</span>
            <span>当前需求：{soulNeedLabels[currentNeed]}</span>
          </div>

          <div
            className="wechatMessages"
            ref={messageListRef}
            onScroll={(event) => {
              if (event.currentTarget.scrollTop > 24) return;
              if (hasOlderMessages) void loadOlderMessages();
              else if (!historyLoading) revealHistoryEnd();
            }}
          >
            {historyNotice ? (
              <p
                className="wechatHistoryState"
                data-terminal={historyNotice.terminal}
                key={historyNotice.key}
                role="status"
              >
                {historyNotice.text}
              </p>
            ) : null}
            {messages.length === 0 && !historyLoading ? (
              <p className="wechatEmpty">和我说点什么吧。</p>
            ) : null}
            {messages.map((message) => (
              <article className="wechatMessage" data-role={message.role} key={message.id}>
                <div className="wechatMessageAvatar">
                  {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                {message.kind === 'web-search' && message.sources?.length ? (
                  <div className="wechatSearchCard">
                    <p>{message.text}</p>
                    <ol>
                      {message.sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} rel="noreferrer" target="_blank">
                            {source.title}
                          </a>
                          {!message.text.includes(source.snippet.trim().slice(0, 60)) ? (
                            <span>{source.snippet}</span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p>{message.text}</p>
                )}
              </article>
            ))}
            {replyBusy ? (
              <article className="wechatMessage" data-role="assistant">
                <div className="wechatMessageAvatar">
                  <Bot size={16} />
                </div>
                <p className="typingDots">
                  <span />
                  <span />
                  <span />
                </p>
              </article>
            ) : null}
          </div>

          <div className="wechatFixedControls">
            <div className="wechatStatus" data-error={Boolean(error)}>
              <span>{error || phaseLabel(phase)}</span>

              <div className="wechatVoiceControls">
                <button
                  aria-pressed={webSearchEnabled}
                  className="wechatSearchToggle"
                  data-active={webSearchEnabled}
                  data-lit={webSearchEnabled && realtimeState === 'connected'}
                  disabled={realtimeState !== 'connected'}
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  title={
                    realtimeState !== 'connected'
                      ? '桌宠未连接，联网搜索暂不可用'
                      : '点击切换联网搜索；含“查询”或“查一下”的明确请求会走后台搜索'
                  }
                  type="button"
                >
                  <i className="wechatSearchLamp" aria-hidden="true" />
                  <Search size={14} />
                  <span>联网搜索</span>
                </button>
              </div>
            </div>
            <div className="wechatVoiceTimings" aria-label="上次语音处理耗时">
              <span>上次语音</span>
              <dl>
                <div title="从 VAD 判定语音开始到片段结束">
                  <dt>录制</dt>
                  <dd>{formatDuration(lastVoiceTimings?.recordingMs)}</dd>
                </div>
                <div title="端点结束后，整段 16kHz 单声道音频交给 SenseVoice worker 的耗时">
                  <dt>传输</dt>
                  <dd>{formatDuration(lastVoiceTimings?.transmissionMs)}</dd>
                </div>
                <div title="整句音频进入 model.int8.onnx 后的离线识别耗时">
                  <dt>识别</dt>
                  <dd>{formatDuration(lastVoiceTimings?.transcriptionMs)}</dd>
                </div>
                <div title="非流式 SenseVoice 整句解码完成耗时">
                  <dt>SenseVoice</dt>
                  <dd>{formatDuration(lastVoiceTimings?.correctionMs)}</dd>
                </div>
                <div title="从校正文本发给 Vercel AI SDK 到首次收到可显示台词">
                  <dt>首段台词</dt>
                  <dd>{formatDuration(llmFirstSpeechMs)}</dd>
                </div>
                <div title="从校正文本发给 Vercel AI SDK 到 Desktop 首个音频开始播放">
                  <dt>开口</dt>
                  <dd>{formatDuration(speechPlaybackStartMs)}</dd>
                </div>
                <div title="从校正文本发给 Vercel AI SDK 到完整回复返回">
                  <dt>LLM 响应</dt>
                  <dd>{formatDuration(lastVoiceTimings?.llmResponseMs)}</dd>
                </div>
              </dl>
            </div>
            <VoiceInputControls voice={voice} showSettingsButton />
            <form className="wechatComposer" onSubmit={submit}>
              <button
                aria-label="打断当前回复"
                className="wechatInterrupt"
                data-active={canInterruptReply}
                disabled={!canInterruptReply}
                onClick={interruptReply}
                title="打断当前模型回复和语音"
                type="button"
              >
                <Square size={16} />
              </button>
              <VoiceMicButton voice={voice} />
              <input
                aria-label="Chat message"
                disabled={replyBusy}
                maxLength={4000}
                onChange={(event) => setInput(event.currentTarget.value)}
                placeholder={
                  phase === 'initializing'
                    ? '正在加载本地语音模型…'
                    : phase === 'listening'
                    ? '正在听…'
                    : '输入消息'
                }
                value={input}
              />
              <button className="wechatSend" disabled={!input.trim() || replyBusy} title="Send" type="submit">
                <Send size={18} />
              </button>
            </form>
          </div>
          {models.length > 0 ? (
            <>
              <input
                className="wechatModelSelect"
                aria-label="LLM model"
                list="chat-llm-model-suggestions"
                onChange={(event) => updateLlmConfig({ model: event.currentTarget.value })}
                value={activeLlmConfig.model}
              />
              <datalist id="chat-llm-model-suggestions">
                {models.map((item) => (
                  <option key={item.name} value={item.name} />
                ))}
              </datalist>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
