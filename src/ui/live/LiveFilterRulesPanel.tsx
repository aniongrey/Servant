import { Filter, Trash2 } from 'lucide-react';
import { Panel } from './LiveTestControls';
import type { LiveTestController } from './useLiveTestController';
import type { FilterRule, FilterRuleAction } from '../../integrations/barrage/filter/LiveContentFilter';

type Props = Pick<
  LiveTestController,
  | 'ruleType'
  | 'setRuleType'
  | 'ruleValue'
  | 'setRuleValue'
  | 'ruleAction'
  | 'setRuleAction'
  | 'ruleError'
  | 'filterRules'
  | 'addFilterRule'
  | 'setFilterRuleEnabled'
  | 'removeFilterRule'
>;

export function LiveFilterRulesPanel({
  ruleType,
  setRuleType,
  ruleValue,
  setRuleValue,
  ruleAction,
  setRuleAction,
  ruleError,
  filterRules,
  addFilterRule,
  setFilterRuleEnabled,
  removeFilterRule
}: Props) {
  return (
    <Panel title="内容过滤规则" icon={<Filter size={17} />}>
      <form className="managementForm" onSubmit={addFilterRule}>
        <div className="fieldPair">
          <label>
            匹配方式
            <select
              value={ruleType}
              onChange={(event) => setRuleType(event.target.value as FilterRule['type'])}
            >
              <option value="keyword">关键词</option>
              <option value="regex">正则</option>
            </select>
          </label>
          <label>
            处理方式
            <select
              value={ruleAction}
              onChange={(event) => setRuleAction(event.target.value as FilterRuleAction)}
            >
              <option value="hide">整条隐藏</option>
              <option value="ignore_ai">仅忽略 AI</option>
            </select>
          </label>
        </div>
        <label>
          匹配内容
          <input
            value={ruleValue}
            onChange={(event) => setRuleValue(event.target.value)}
            placeholder={ruleType === 'regex' ? '例如：https?://' : '例如：广告'}
          />
        </label>
        <div className="formActionRow">
          <span className={ruleError ? 'formError' : ''}>{ruleError || `${filterRules.length} 条规则`}</span>
          <button type="submit">添加规则</button>
        </div>
      </form>
      <div className="managementList">
        {filterRules.map((rule) => (
          <div key={rule.id} data-disabled={!rule.enabled}>
            <input
              aria-label={`${rule.value} 启用状态`}
              type="checkbox"
              checked={rule.enabled}
              onChange={(event) => setFilterRuleEnabled(rule, event.target.checked)}
            />
            <label>
              <strong>{rule.value}</strong>
              <span>
                {rule.type === 'keyword' ? '关键词' : '正则'} / {rule.action === 'hide' ? '隐藏' : '不响应'}
              </span>
            </label>
            <button
              className="iconButton"
              type="button"
              title={`删除规则 ${rule.value}`}
              onClick={() => removeFilterRule(rule.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
