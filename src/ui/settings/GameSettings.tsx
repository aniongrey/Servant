import { useState } from 'react';
import { Flame, Gamepad2, CircleDot, ChevronRight, PackageSearch, PlugZap } from 'lucide-react';
import { PanelTitle, FakeToggle } from './SettingsControls';

export function GameSettings() {
  const [game, setGame] = useState<'poe2' | 'torchlight'>('poe2');
  return (
    <div>
      <div className="aurelia-tabs" role="tablist" aria-label="游戏监听类型">
        <button
          type="button"
          role="tab"
          aria-selected={game === 'poe2'}
          data-active={game === 'poe2'}
          onClick={() => setGame('poe2')}
        >
          <Flame size={15} /> Path of Exile 2
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={game === 'torchlight'}
          data-active={game === 'torchlight'}
          onClick={() => setGame('torchlight')}
        >
          <Gamepad2 size={15} /> 火炬之光：无限
        </button>
      </div>
      {game === 'poe2' ? <Poe2Settings /> : <TorchlightSettings />}
    </div>
  );
}

function Poe2Settings() {
  return (
    <div className="aurelia-content-grid">
      <section className="aurelia-panel aurelia-panel-wide aurelia-game-hero">
        <div className="aurelia-game-emblem">
          <Flame size={28} />
        </div>
        <div>
          <span>GAME WATCH · POE2</span>
          <h2>Path of Exile 2</h2>
          <p>Client.txt 日志监听 / 掉落事件解析 / 角色反应分发</p>
        </div>
        <div className="aurelia-connection-state">
          <CircleDot size={14} /> 监听中
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="日志监听" eyebrow="CLIENT LOG" />
        <label className="aurelia-field">
          <span>Client.txt 路径</span>
          <input readOnly value="C:\\Games\\Path of Exile 2\\logs\\Client.txt" />
        </label>
        <div className="aurelia-select-row">
          <span>自动恢复监听</span>
          <FakeToggle active />
        </div>
        <div className="aurelia-select-row">
          <span>从文件末尾开始</span>
          <FakeToggle active />
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="战利品规则" eyebrow="REACTIONS" />
        <div className="aurelia-loot-rule">
          <span>Divine Orb</span>
          <ChevronRight size={14} />
          <strong>poe2_divine_drop_001</strong>
          <em>P90</em>
        </div>
        <div className="aurelia-empty-row compact">
          <PackageSearch size={15} />
          <span>更多掉落规则待添加</span>
        </div>
      </section>
      <section className="aurelia-panel aurelia-panel-wide">
        <PanelTitle title="事件处理链" eyebrow="PIPELINE" />
        <div className="aurelia-pipeline">
          <span>ClientLogWatcher</span>
          <ChevronRight />
          <span>POE2EventParser</span>
          <ChevronRight />
          <span>LootDetector</span>
          <ChevronRight />
          <span>ReactionDispatcher</span>
        </div>
      </section>
    </div>
  );
}

function TorchlightSettings() {
  return (
    <div className="aurelia-content-grid">
      <section className="aurelia-panel aurelia-panel-wide aurelia-game-hero torchlight">
        <div className="aurelia-game-emblem">
          <Gamepad2 size={28} />
        </div>
        <div>
          <span>GAME WATCH · TORCHLIGHT</span>
          <h2>火炬之光：无限</h2>
          <p>独立监听配置页 · 接口与事件映射预留</p>
        </div>
        <div className="aurelia-pending-badge">待接入</div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="数据来源" eyebrow="SOURCE" />
        <label className="aurelia-field">
          <span>监听方式</span>
          <select defaultValue="log">
            <option value="log">本地日志文件</option>
            <option value="api">游戏数据接口</option>
          </select>
        </label>
        <label className="aurelia-field">
          <span>日志目录</span>
          <input readOnly value="尚未配置" />
        </label>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="事件映射" eyebrow="EVENT MAP" />
        <div className="aurelia-empty-row tall">
          <PlugZap size={20} />
          <span>等待监听适配器</span>
          <small>后续可添加掉落、死亡、升级与 Boss 事件</small>
        </div>
      </section>
    </div>
  );
}
