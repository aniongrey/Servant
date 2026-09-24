import { type FormEvent, useState } from 'react';
import { useLiveTestSession } from './useLiveTestSession';
import type { BlacklistMode } from '../../integrations/barrage/blacklist/BlacklistManager';
import type { LivePlatform } from '../../integrations/barrage/events/LiveEvent';
import type { FilterRule, FilterRuleAction } from '../../integrations/barrage/filter/LiveContentFilter';

import { initialComposer, createRawEvent, type ComposerState } from './liveTestEvents';
import { saveFilterRules } from './liveTestFilterRules';
export function useLiveTestController() {
  const session = useLiveTestSession();
  const { harness, refresh: forceRender, ingest } = session;
  const [composer, setComposer] = useState<ComposerState>(initialComposer);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(createRawEvent(initialComposer), null, 2));
  const [rawError, setRawError] = useState('');
  const [blacklistPlatform, setBlacklistPlatform] = useState<LivePlatform>('bilibili');
  const [blacklistUserId, setBlacklistUserId] = useState('viewer-01');
  const [blacklistMode, setBlacklistMode] = useState<BlacklistMode>('ignore');
  const [blacklistDuration, setBlacklistDuration] = useState('permanent');
  const [blacklistError, setBlacklistError] = useState('');
  const [ruleType, setRuleType] = useState<FilterRule['type']>('keyword');
  const [ruleValue, setRuleValue] = useState('广告');
  const [ruleAction, setRuleAction] = useState<FilterRuleAction>('hide');
  const [ruleError, setRuleError] = useState('');
  const debug = harness.system.getDebugState();
  const queuedTotal = debug.queue.high + debug.queue.normal + debug.queue.low;
  const blacklistEntries = harness.system.blacklist.getAll();
  const filterRules = harness.config.filter.rules;

  function handleComposerSubmit(event: FormEvent) {
    event.preventDefault();
    ingest(createRawEvent(composer));
  }

  function handleRawSubmit() {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      setRawError('');
      ingest(parsed);
    } catch (error) {
      setRawError(error instanceof Error ? error.message : 'JSON 解析失败');
    }
  }

  function reset() {
    session.resetSession();
    setRawError('');
  }

  async function addBlacklistEntry(event: FormEvent) {
    event.preventDefault();
    const userId = blacklistUserId.trim();
    if (!userId) {
      setBlacklistError('请输入用户 ID');
      return;
    }
    const durationMs = blacklistDuration === 'permanent' ? undefined : Number(blacklistDuration);
    try {
      await harness.system.blacklist.add({
        platform: blacklistPlatform,
        userId,
        mode: blacklistMode,
        expiresAt: durationMs ? Date.now() + durationMs : undefined
      });
      setBlacklistError('');
      forceRender();
    } catch (error) {
      setBlacklistError(error instanceof Error ? error.message : '黑名单保存失败');
    }
  }

  async function removeBlacklistEntry(platform: LivePlatform, userId: string) {
    try {
      await harness.system.blacklist.remove(platform, userId);
      setBlacklistError('');
      forceRender();
    } catch (error) {
      setBlacklistError(error instanceof Error ? error.message : '黑名单删除失败');
    }
  }

  function addFilterRule(event: FormEvent) {
    event.preventDefault();
    const value = ruleValue.trim();
    if (!value) {
      setRuleError('请输入匹配内容');
      return;
    }
    if (ruleType === 'regex') {
      try {
        new RegExp(value, 'i');
      } catch {
        setRuleError('正则表达式无效');
        return;
      }
    }
    filterRules.push({
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: ruleType,
      value,
      action: ruleAction,
      enabled: true
    });
    saveFilterRules(filterRules);
    setRuleError('');
    forceRender();
  }

  function setFilterRuleEnabled(rule: FilterRule, enabled: boolean) {
    rule.enabled = enabled;
    saveFilterRules(filterRules);
    forceRender();
  }

  function removeFilterRule(ruleId: string) {
    const index = filterRules.findIndex((rule) => rule.id === ruleId);
    if (index >= 0) filterRules.splice(index, 1);
    saveFilterRules(filterRules);
    forceRender();
  }

  return {
    ...session,
    composer,
    setComposer,
    rawJson,
    setRawJson,
    rawError,
    blacklistPlatform,
    setBlacklistPlatform,
    blacklistUserId,
    setBlacklistUserId,
    blacklistMode,
    setBlacklistMode,
    blacklistDuration,
    setBlacklistDuration,
    blacklistError,
    ruleType,
    setRuleType,
    ruleValue,
    setRuleValue,
    ruleAction,
    setRuleAction,
    ruleError,
    debug,
    queuedTotal,
    blacklistEntries,
    filterRules,
    ingest,
    handleComposerSubmit,
    handleRawSubmit,
    reset,
    addBlacklistEntry,
    removeBlacklistEntry,
    addFilterRule,
    setFilterRuleEnabled,
    removeFilterRule
  };
}

export type LiveTestController = ReturnType<typeof useLiveTestController>;
