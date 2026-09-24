import { ShieldAlert, Trash2 } from 'lucide-react';
import { Panel } from './LiveTestControls';
import type { LiveTestController } from './useLiveTestController';
import type { LivePlatform } from '../../integrations/barrage/events/LiveEvent';
import type { BlacklistMode } from '../../integrations/barrage/blacklist/BlacklistManager';
import { formatExpiry } from './liveTestFormat';

type Props = Pick<
  LiveTestController,
  | 'blacklistPlatform'
  | 'setBlacklistPlatform'
  | 'blacklistUserId'
  | 'setBlacklistUserId'
  | 'blacklistMode'
  | 'setBlacklistMode'
  | 'blacklistDuration'
  | 'setBlacklistDuration'
  | 'blacklistError'
  | 'blacklistEntries'
  | 'addBlacklistEntry'
  | 'removeBlacklistEntry'
>;

export function LiveBlacklistPanel({
  blacklistPlatform,
  setBlacklistPlatform,
  blacklistUserId,
  setBlacklistUserId,
  blacklistMode,
  setBlacklistMode,
  blacklistDuration,
  setBlacklistDuration,
  blacklistError,
  blacklistEntries,
  addBlacklistEntry,
  removeBlacklistEntry
}: Props) {
  return (
    <Panel title="用户黑名单" icon={<ShieldAlert size={17} />}>
      <form className="managementForm" onSubmit={addBlacklistEntry}>
        <div className="fieldPair">
          <label>
            平台
            <select
              value={blacklistPlatform}
              onChange={(event) => setBlacklistPlatform(event.target.value as LivePlatform)}
            >
              <option value="bilibili">Bilibili</option>
              <option value="douyin">抖音</option>
            </select>
          </label>
          <label>
            用户 ID
            <input value={blacklistUserId} onChange={(event) => setBlacklistUserId(event.target.value)} />
          </label>
        </div>
        <div className="fieldPair">
          <label>
            处理方式
            <select
              value={blacklistMode}
              onChange={(event) => setBlacklistMode(event.target.value as BlacklistMode)}
            >
              <option value="ignore">整条丢弃</option>
              <option value="no_ai_response">仅禁止 AI 响应</option>
            </select>
          </label>
          <label>
            有效期
            <select value={blacklistDuration} onChange={(event) => setBlacklistDuration(event.target.value)}>
              <option value="permanent">永久</option>
              <option value="600000">10 分钟</option>
              <option value="3600000">1 小时</option>
              <option value="86400000">24 小时</option>
            </select>
          </label>
        </div>
        <div className="formActionRow">
          <span className={blacklistError ? 'formError' : ''}>
            {blacklistError || `${blacklistEntries.length} 个用户`}
          </span>
          <button type="submit">加入黑名单</button>
        </div>
      </form>
      <div className="managementList">
        {blacklistEntries.map((entry) => (
          <div key={`${entry.platform}:${entry.userId}`}>
            <label>
              <strong>{entry.userId}</strong>
              <span>
                {entry.platform} / {entry.mode === 'ignore' ? '丢弃' : '不响应'}
                {entry.expiresAt ? ` / ${formatExpiry(entry.expiresAt)}` : ''}
              </span>
            </label>
            <button
              className="iconButton"
              type="button"
              title={`移除 ${entry.userId}`}
              onClick={() => void removeBlacklistEntry(entry.platform, entry.userId)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
