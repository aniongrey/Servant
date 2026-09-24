import { type AgentRuntime } from '../../ai/AgentRuntime';
import { type DebugPanelSectionId } from './debugConfig';
import { type RuntimeSnapshot } from '../../app/runtimeTypes';
import { RotateCcw, Ban, SkipForward, Send, Plus, Trash2 } from 'lucide-react';
import { DebugSection } from './DebugControls';
import type { DebugEventControls } from './useDebugEventControls';

export function DirectorPanel({
  open,
  onToggle,
  eventControls,
  engine
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  eventControls: Pick<DebugEventControls, 'events' | 'forceEventId' | 'setForceEventId'>;
  engine: AgentRuntime;
}) {
  const { events, forceEventId, setForceEventId } = eventControls;
  return (
    <DebugSection id="director" onToggle={onToggle} open={open} title="Director">
      <div className="buttonGrid compact">
        <button className="danger" onClick={engine.actions.interrupt}>
          <Ban size={17} />
          Interrupt
        </button>
        <button onClick={engine.actions.skipStep}>
          <SkipForward size={17} />
          Skip Step
        </button>
        <button onClick={engine.actions.replayStep}>
          <RotateCcw size={17} />
          Replay Step
        </button>
        <button onClick={engine.actions.replayEvent}>
          <RotateCcw size={17} />
          Replay Event
        </button>
      </div>
      <div className="inlineControl">
        <select value={forceEventId} onChange={(event) => setForceEventId(event.currentTarget.value)}>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.id}
            </option>
          ))}
        </select>
        <button onClick={() => engine.actions.forceEvent(forceEventId)}>
          <Send size={17} />
          Force
        </button>
      </div>
    </DebugSection>
  );
}

export function InputPanel({
  open,
  onToggle,
  eventControls
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  eventControls: Pick<DebugEventControls, 'input' | 'setInput' | 'submitInput'>;
}) {
  const { input, setInput, submitInput } = eventControls;
  return (
    <DebugSection id="input" onToggle={onToggle} open={open} title="Input">
      <form className="inlineControl" onSubmit={submitInput}>
        <input
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="下班啦 / 开工 / 晚安"
        />
        <button type="submit">
          <Send size={17} />
          Send
        </button>
      </form>
    </DebugSection>
  );
}

export function CustomTriggersPanel({
  open,
  onToggle,
  eventControls,
  engine,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  eventControls: Pick<
    DebugEventControls,
    'events' | 'newPhrase' | 'setNewPhrase' | 'newEventId' | 'setNewEventId' | 'addCustomTrigger'
  >;
  engine: AgentRuntime;
  snapshot: RuntimeSnapshot;
}) {
  const { events, newPhrase, setNewPhrase, newEventId, setNewEventId, addCustomTrigger } = eventControls;
  return (
    <DebugSection id="customTriggers" onToggle={onToggle} open={open} title="Custom Triggers">
      <form className="customForm" onSubmit={addCustomTrigger}>
        <input
          value={newPhrase}
          onChange={(event) => setNewPhrase(event.currentTarget.value)}
          placeholder="口令，逗号分隔"
        />
        <select value={newEventId} onChange={(event) => setNewEventId(event.currentTarget.value)}>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.id}
            </option>
          ))}
        </select>
        <button type="submit">
          <Plus size={17} />
          Add
        </button>
      </form>
      <ol className="triggerList">
        {snapshot.customTriggers.map((trigger) => (
          <li key={trigger.id} data-disabled={!trigger.enabled}>
            <button onClick={() => engine.actions.toggleCustomTrigger(trigger.id)}>
              {trigger.enabled ? 'On' : 'Off'}
            </button>
            <span>
              {(trigger.phrasePatterns ?? []).join(' / ')} → {trigger.eventId}
            </span>
            <button
              className="iconButton danger"
              onClick={() => engine.actions.removeCustomTrigger(trigger.id)}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ol>
    </DebugSection>
  );
}
