import {
  Activity,
  Ban,
  CircleStop,
  MessageSquareText,
  Play,
  Plug,
  PlugZap,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Users
} from 'lucide-react';
import { useLiveTestController } from './useLiveTestController';
import { Metric, Panel, QueueColumn, EventRow, EmptyState } from './LiveTestControls';
import { categoryLabels, formatSocketStatus, formatTime } from './liveTestFormat';
import { runScenario } from './liveTestEvents';
import { LiveComposerPanel } from './LiveComposerPanel';
import { LiveBlacklistPanel } from './LiveBlacklistPanel';
import { LiveFilterRulesPanel } from './LiveFilterRulesPanel';

export function LiveTestPage() {
  const controls = useLiveTestController();
  const {
    harness,
    autoTick,
    setAutoTick,
    rawJson,
    setRawJson,
    rawError,
    wsUrl,
    setWsUrl,
    socketStatus,
    debug,
    queuedTotal,
    ingest,
    handleRawSubmit,
    connectSocket,
    disconnectSocket,
    reset
  } = controls;
  return (
    <main className="livePage">
      <header className="liveTopbar">
        <div>
          <p className="liveEyebrow">CHARACTER DRAMA ENGINE / LIVE V1</p>
          <h1>直播事件调度测试台</h1>
        </div>
        <div className="liveTopActions">
          <span className="connectionStatus" data-status={socketStatus}>
            <span />
            {formatSocketStatus(socketStatus)}
          </span>
          <label className="switchControl">
            <input
              type="checkbox"
              checked={autoTick}
              onChange={(event) => setAutoTick(event.target.checked)}
            />
            <span>自动调度</span>
          </label>
          <button className="iconButton" type="button" title="重置测试台" onClick={reset}>
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      <section className="metricStrip" aria-label="运行统计">
        <Metric icon={<Activity size={17} />} label="已接收" value={debug.stats.received} />
        <Metric icon={<Ban size={17} />} label="已过滤" value={debug.stats.filtered} />
        <Metric icon={<Users size={17} />} label="当前排队" value={queuedTotal} />
        <Metric icon={<MessageSquareText size={17} />} label="已响应" value={debug.stats.responded} />
        <Metric icon={<CircleStop size={17} />} label="已过期" value={debug.stats.expired} />
      </section>

      <section className="liveWorkspace">
        <aside className="controlRail">
          <Panel title="BarrageGrab 连接" icon={<PlugZap size={17} />}>
            <div className="inlineField">
              <input
                aria-label="WebSocket 地址"
                value={wsUrl}
                onChange={(event) => setWsUrl(event.target.value)}
              />
              {socketStatus === 'disconnected' ? (
                <button className="primaryIconButton" type="button" title="连接" onClick={connectSocket}>
                  <Plug size={17} />
                </button>
              ) : (
                <button className="dangerIconButton" type="button" title="断开" onClick={disconnectSocket}>
                  <CircleStop size={17} />
                </button>
              )}
            </div>
          </Panel>

          <LiveComposerPanel
            composer={controls.composer}
            setComposer={controls.setComposer}
            handleComposerSubmit={controls.handleComposerSubmit}
          />

          <LiveBlacklistPanel
            blacklistPlatform={controls.blacklistPlatform}
            setBlacklistPlatform={controls.setBlacklistPlatform}
            blacklistUserId={controls.blacklistUserId}
            setBlacklistUserId={controls.setBlacklistUserId}
            blacklistMode={controls.blacklistMode}
            setBlacklistMode={controls.setBlacklistMode}
            blacklistDuration={controls.blacklistDuration}
            setBlacklistDuration={controls.setBlacklistDuration}
            blacklistError={controls.blacklistError}
            blacklistEntries={controls.blacklistEntries}
            addBlacklistEntry={controls.addBlacklistEntry}
            removeBlacklistEntry={controls.removeBlacklistEntry}
          />

          <LiveFilterRulesPanel
            ruleType={controls.ruleType}
            setRuleType={controls.setRuleType}
            ruleValue={controls.ruleValue}
            setRuleValue={controls.setRuleValue}
            ruleAction={controls.ruleAction}
            setRuleAction={controls.setRuleAction}
            ruleError={controls.ruleError}
            filterRules={controls.filterRules}
            addFilterRule={controls.addFilterRule}
            setFilterRuleEnabled={controls.setFilterRuleEnabled}
            removeFilterRule={controls.removeFilterRule}
          />

          <Panel title="验收场景" icon={<Sparkles size={17} />}>
            <div className="scenarioGrid">
              <button type="button" onClick={() => runScenario('low', ingest)}>
                低价值弹幕 x35
              </button>
              <button type="button" onClick={() => runScenario('question', ingest)}>
                点名提问
              </button>
              <button type="button" onClick={() => runScenario('duplicate', ingest)}>
                多人同句 x30
              </button>
              <button type="button" onClick={() => runScenario('gift', ingest)}>
                高价值礼物
              </button>
            </div>
          </Panel>
        </aside>

        <section className="queueArea">
          <div className="sectionHeading">
            <div>
              <span>调度状态</span>
              <strong>
                {debug.controller.isSpeaking
                  ? '正在响应'
                  : debug.controller.cooldownRemaining > 0
                  ? '冷却中'
                  : '空闲'}
              </strong>
            </div>
            <button type="button" title="执行一次调度" onClick={() => void harness.tick()}>
              <Play size={16} />
              执行 Tick
            </button>
          </div>
          <div className="queueGrid">
            <QueueColumn band="high" events={harness.system.queue.high} />
            <QueueColumn band="normal" events={harness.system.queue.normal} />
            <QueueColumn band="low" events={harness.system.queue.low} />
          </div>
        </section>

        <aside className="resultRail">
          <Panel
            title="AI 应响应"
            icon={<MessageSquareText size={17} />}
            action={
              <button
                className="iconButton"
                type="button"
                title="清空响应记录"
                onClick={() => {
                  harness.clearResponses();
                }}
              >
                <Trash2 size={15} />
              </button>
            }
          >
            <div className="responseList">
              {harness.responses.length === 0 && <EmptyState text="等待调度结果" />}
              {[...harness.responses].reverse().map((event, index) => (
                <EventRow key={`${event.id}:${index}`} event={event} compact />
              ))}
            </div>
          </Panel>
          <Panel
            title="处理流水"
            icon={<Activity size={17} />}
            action={
              <button
                className="iconButton"
                type="button"
                title="清空流水"
                onClick={() => {
                  harness.clearActivity();
                }}
              >
                <Trash2 size={15} />
              </button>
            }
          >
            <div className="activityList">
              {harness.activity.length === 0 && <EmptyState text="发送事件后显示处理记录" />}
              {[...harness.activity]
                .reverse()
                .slice(0, 80)
                .map((entry) => (
                  <div className="activityRow" key={entry.id} data-category={entry.category}>
                    <span>{categoryLabels[entry.category]}</span>
                    <p>{entry.message}</p>
                    <time>{formatTime(entry.time)}</time>
                  </div>
                ))}
            </div>
          </Panel>
        </aside>
      </section>

      <section className="rawPanel">
        <div className="panelHeader">
          <div>
            <MessageSquareText size={17} />
            <h2>原始 JSON 输入</h2>
          </div>
        </div>
        <textarea value={rawJson} onChange={(event) => setRawJson(event.target.value)} spellCheck={false} />
        <div className="rawActions">
          <span className={rawError ? 'rawError' : ''}>
            {rawError || '按 BarrageGrab 原始消息格式送入完整处理链。'}
          </span>
          <button className="primaryButton" type="button" onClick={handleRawSubmit}>
            <Send size={16} />
            发送 JSON
          </button>
        </div>
      </section>
    </main>
  );
}
