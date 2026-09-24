import { type AgentRuntime } from '../../ai/AgentRuntime';
import { type DebugPanelSectionId, emotionLabels, relationshipLabels } from './debugConfig';
import { type RuntimeSnapshot } from '../../app/runtimeTypes';
import { Metric, DebugSection, Slider } from './DebugControls';
import { formatActionPartState, formatActiveLayers, formatCooldowns } from './debugFormat';

export function RuntimeTimeline({ snapshot }: { snapshot: RuntimeSnapshot }) {
  return (
    <section className="timeline">
      <Metric label="Body" value={`${snapshot.body.currentAction ?? 'none'} / ${snapshot.body.phase}`} />
      <Metric label="Actions" value={snapshot.action.activeActions.join(', ') || 'none'} />
      <Metric label="Action Parts" value={formatActionPartState(snapshot.action.activeParts)} />
      <Metric label="Active Layers" value={formatActiveLayers(snapshot.body.activeLayers)} />
      <Metric
        label="Expression"
        value={`${snapshot.expression.id} ${snapshot.expression.weight.toFixed(2)}`}
      />
      <Metric label="Accessory" value={snapshot.accessory.preset} />
      <Metric label="Gaze" value={snapshot.expression.gaze} />
      <Metric label="FX" value={Object.keys(snapshot.fx.active).join(', ') || 'none'} />
      <Metric label="Loaded VRMA" value={snapshot.body.loadedIds.join(', ') || 'none'} />
    </section>
  );
}

export function RuntimeEmotionPanel({
  open,
  onToggle,
  engine,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  engine: AgentRuntime;
  snapshot: RuntimeSnapshot;
}) {
  return (
    <DebugSection id="runtimeEmotion" onToggle={onToggle} open={open} title="Runtime Emotion">
      {(Object.keys(emotionLabels) as Array<keyof RuntimeSnapshot['emotions']>).map((key) => (
        <Slider
          key={key}
          label={emotionLabels[key]}
          value={snapshot.emotions[key]}
          onChange={(value) => engine.actions.updateEmotion(key, value)}
        />
      ))}
    </DebugSection>
  );
}

export function RuntimeRelationshipPanel({
  open,
  onToggle,
  engine,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  engine: AgentRuntime;
  snapshot: RuntimeSnapshot;
}) {
  return (
    <DebugSection id="runtimeRelationship" onToggle={onToggle} open={open} title="Runtime Relationship">
      {(Object.keys(relationshipLabels) as Array<keyof RuntimeSnapshot['relationship']>).map((key) => (
        <Slider
          key={key}
          label={relationshipLabels[key]}
          value={snapshot.relationship[key]}
          onChange={(value) => engine.actions.updateRelationship(key, value)}
        />
      ))}
    </DebugSection>
  );
}

export function RuntimeStatusPanel({
  open,
  onToggle,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  snapshot: RuntimeSnapshot;
}) {
  return (
    <DebugSection id="runtime" onToggle={onToggle} open={open} title="Runtime">
      <dl className="statusList">
        <dt>comfortCount</dt>
        <dd>{snapshot.counters.comfortCount ?? 0}</dd>
        <dt>currentEvent</dt>
        <dd>{snapshot.director.currentEvent?.title ?? 'none'}</dd>
        <dt>lastInput</dt>
        <dd>{snapshot.trigger.lastInput || 'none'}</dd>
        <dt>lastTrigger</dt>
        <dd>{snapshot.trigger.lastMatchedTrigger ?? snapshot.trigger.lastBuiltInTrigger ?? 'none'}</dd>
        <dt>cooldowns</dt>
        <dd>{formatCooldowns(snapshot.director.cooldowns)}</dd>
      </dl>
    </DebugSection>
  );
}

export function RuntimeLogPanel({
  open,
  onToggle,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  snapshot: RuntimeSnapshot;
}) {
  return (
    <DebugSection className="logs" id="log" onToggle={onToggle} open={open} title="Log">
      <ol>
        {snapshot.logs.slice(0, 10).map((log) => (
          <li key={`${log.at}-${log.message}`} data-level={log.level}>
            {new Date(log.at).toLocaleTimeString()} {log.message}
          </li>
        ))}
      </ol>
    </DebugSection>
  );
}
