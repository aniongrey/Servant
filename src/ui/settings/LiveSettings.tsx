import { LIVE_FILTER_RULES_STORAGE_KEY } from '../../app/settings/storageKeys';
import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { type FilterRule, type FilterRuleAction } from '../../integrations/barrage/filter/LiveContentFilter';
import {
  BlacklistManager,
  LocalStorageBlacklistStorage,
  type BlacklistEntry,
  type BlacklistMode
} from '../../integrations/barrage/blacklist/BlacklistManager';
import { type LivePlatform } from '../../integrations/barrage/events/LiveEvent';
import { PanelTitle, Toggle } from './SettingsControls';
import { Filter, ShieldCheck, Trash2 } from 'lucide-react';
import { readStoredJson } from '../../app/settings/browserStorage';

export function LiveSettings() {
  const [filterRules, setFilterRules] = useState<FilterRule[]>(loadLiveFilterRules);
  const [ruleType, setRuleType] = useState<FilterRule['type']>('keyword');
  const [ruleAction, setRuleAction] = useState<FilterRuleAction>('hide');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleError, setRuleError] = useState('');
  const blacklistManager = useMemo(() => new BlacklistManager(new LocalStorageBlacklistStorage()), []);
  const [blacklistEntries, setBlacklistEntries] = useState<BlacklistEntry[]>([]);
  const [blacklistPlatform, setBlacklistPlatform] = useState<LivePlatform>('bilibili');
  const [blacklistUserId, setBlacklistUserId] = useState('');
  const [blacklistMode, setBlacklistMode] = useState<BlacklistMode>('ignore');
  const [blacklistDuration, setBlacklistDuration] = useState('permanent');
  const [blacklistError, setBlacklistError] = useState('');

  useEffect(() => saveLiveFilterRules(filterRules), [filterRules]);
  useEffect(() => {
    void blacklistManager.load().then(() => setBlacklistEntries(blacklistManager.getAll()));
  }, [blacklistManager]);

  const addFilterRule = (event: FormEvent) => {
    event.preventDefault();
    const value = ruleValue.trim();
    if (!value) {
      setRuleError('请输入匹配内容');
      return;
    }
    if (ruleType === 'regex') {
      try {
        new RegExp(value);
      } catch {
        setRuleError('正则表达式格式无效');
        return;
      }
    }
    setFilterRules((current) => [
      ...current,
      {
        id: `rule-${crypto.randomUUID()}`,
        type: ruleType,
        value,
        action: ruleAction,
        enabled: true
      }
    ]);
    setRuleValue('');
    setRuleError('');
  };
  const addBlacklistEntry = async (event: FormEvent) => {
    event.preventDefault();
    const userId = blacklistUserId.trim();
    if (!userId) {
      setBlacklistError('请输入用户 ID');
      return;
    }
    const durationMs = blacklistDuration === 'permanent' ? undefined : Number(blacklistDuration);
    await blacklistManager.add({
      platform: blacklistPlatform,
      userId,
      mode: blacklistMode,
      reason: 'homepage.manual',
      expiresAt: durationMs ? Date.now() + durationMs : undefined
    });
    setBlacklistEntries(blacklistManager.getAll());
    setBlacklistUserId('');
    setBlacklistError('');
  };
  const removeBlacklistEntry = async (entry: BlacklistEntry) => {
    await blacklistManager.remove(entry.platform, entry.userId);
    setBlacklistEntries(blacklistManager.getAll());
  };

  return (
    <div className="aurelia-content-grid aurelia-live-settings-grid">
      <section className="aurelia-panel">
        <PanelTitle title="内容过滤规则" eyebrow="CONTENT FILTER" />
        <form className="aurelia-management-form" onSubmit={addFilterRule}>
          <div className="aurelia-field-pair">
            <label className="aurelia-field">
              <span>匹配方式</span>
              <select
                value={ruleType}
                onChange={(event) => setRuleType(event.currentTarget.value as FilterRule['type'])}
              >
                <option value="keyword">关键词</option>
                <option value="regex">正则表达式</option>
              </select>
            </label>
            <label className="aurelia-field">
              <span>处理方式</span>
              <select
                value={ruleAction}
                onChange={(event) => setRuleAction(event.currentTarget.value as FilterRuleAction)}
              >
                <option value="hide">整条隐藏</option>
                <option value="ignore_ai">仅忽略 AI</option>
              </select>
            </label>
          </div>
          <label className="aurelia-field">
            <span>匹配内容</span>
            <input
              value={ruleValue}
              onChange={(event) => setRuleValue(event.currentTarget.value)}
              placeholder={ruleType === 'regex' ? '例如：https?://' : '例如：广告'}
            />
          </label>
          <div className="aurelia-form-actions">
            <span data-error={Boolean(ruleError)}>{ruleError || `${filterRules.length} 条规则`}</span>
            <button type="submit">
              <Filter size={14} /> 添加规则
            </button>
          </div>
        </form>
        <div className="aurelia-management-list">
          {filterRules.length === 0 ? (
            <div className="aurelia-empty-management">
              <ShieldCheck size={17} />
              暂无过滤规则
            </div>
          ) : (
            filterRules.map((rule) => (
              <div data-disabled={!rule.enabled} key={rule.id}>
                <Toggle
                  checked={rule.enabled}
                  label={`${rule.value} 启用状态`}
                  onChange={(enabled) =>
                    setFilterRules((current) =>
                      current.map((item) => (item.id === rule.id ? { ...item, enabled } : item))
                    )
                  }
                />
                <span>
                  <strong>{rule.value}</strong>
                  <small>
                    {rule.type === 'keyword' ? '关键词' : '正则'} ·{' '}
                    {rule.action === 'hide' ? '隐藏' : '不响应'}
                  </small>
                </span>
                <button
                  aria-label={`删除规则 ${rule.value}`}
                  className="aurelia-danger-icon"
                  type="button"
                  onClick={() => setFilterRules((current) => current.filter((item) => item.id !== rule.id))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="用户黑名单" eyebrow="BLACKLIST" />
        <form className="aurelia-management-form" onSubmit={(event) => void addBlacklistEntry(event)}>
          <div className="aurelia-field-pair">
            <label className="aurelia-field">
              <span>平台</span>
              <select
                value={blacklistPlatform}
                onChange={(event) => setBlacklistPlatform(event.currentTarget.value as LivePlatform)}
              >
                <option value="bilibili">Bilibili</option>
                <option value="douyin">抖音</option>
              </select>
            </label>
            <label className="aurelia-field">
              <span>用户 ID</span>
              <input
                value={blacklistUserId}
                onChange={(event) => setBlacklistUserId(event.currentTarget.value)}
                placeholder="输入平台用户 ID"
              />
            </label>
          </div>
          <div className="aurelia-field-pair">
            <label className="aurelia-field">
              <span>处理方式</span>
              <select
                value={blacklistMode}
                onChange={(event) => setBlacklistMode(event.currentTarget.value as BlacklistMode)}
              >
                <option value="ignore">整条丢弃</option>
                <option value="no_ai_response">仅禁止 AI 回复</option>
              </select>
            </label>
            <label className="aurelia-field">
              <span>有效期</span>
              <select
                value={blacklistDuration}
                onChange={(event) => setBlacklistDuration(event.currentTarget.value)}
              >
                <option value="permanent">永久</option>
                <option value="600000">10 分钟</option>
                <option value="3600000">1 小时</option>
                <option value="86400000">24 小时</option>
              </select>
            </label>
          </div>
          <div className="aurelia-form-actions">
            <span data-error={Boolean(blacklistError)}>
              {blacklistError || `${blacklistEntries.length} 个用户`}
            </span>
            <button type="submit">
              <ShieldCheck size={14} /> 加入黑名单
            </button>
          </div>
        </form>
        <div className="aurelia-management-list">
          {blacklistEntries.length === 0 ? (
            <div className="aurelia-empty-management">
              <ShieldCheck size={17} />
              当前没有黑名单用户
            </div>
          ) : (
            blacklistEntries.map((entry) => (
              <div key={`${entry.platform}:${entry.userId}`}>
                <span className="aurelia-platform-badge">{entry.platform === 'bilibili' ? 'B' : 'D'}</span>
                <span>
                  <strong>{entry.userId}</strong>
                  <small>
                    {entry.platform} · {entry.mode === 'ignore' ? '整条丢弃' : '不触发 AI'} ·{' '}
                    {formatBlacklistExpiry(entry.expiresAt)}
                  </small>
                </span>
                <button
                  aria-label={`移除黑名单 ${entry.userId}`}
                  className="aurelia-danger-icon"
                  type="button"
                  onClick={() => void removeBlacklistEntry(entry)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function loadLiveFilterRules(): FilterRule[] {
  const rules = readStoredJson(LIVE_FILTER_RULES_STORAGE_KEY);
  if (!Array.isArray(rules)) return [];
  return rules.filter((rule): rule is FilterRule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const candidate = rule as Partial<FilterRule>;
    return (
      typeof candidate.id === 'string' &&
      (candidate.type === 'keyword' || candidate.type === 'regex') &&
      typeof candidate.value === 'string' &&
      (candidate.action === 'hide' || candidate.action === 'ignore_ai') &&
      typeof candidate.enabled === 'boolean'
    );
  });
}

function saveLiveFilterRules(rules: FilterRule[]): void {
  localStorage.setItem(LIVE_FILTER_RULES_STORAGE_KEY, JSON.stringify(rules));
}

function formatBlacklistExpiry(expiresAt?: number): string {
  if (!expiresAt) return '永久';
  const remaining = Math.max(0, expiresAt - Date.now());
  if (remaining < 60 * 60 * 1000) return `${Math.ceil(remaining / 60_000)} 分钟`;
  return `${Math.ceil(remaining / 3_600_000)} 小时`;
}
