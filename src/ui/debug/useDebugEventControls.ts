import { useState, useMemo } from 'react';
import { type FormEvent } from 'react';
import { type AgentRuntime } from '../../ai/AgentRuntime';
import { QUICK_CUSTOM_TRIGGER_COOLDOWN_MS } from './debugConfig';

export function useDebugEventControls(engine: AgentRuntime) {
  const events = useMemo(() => engine.director.listEvents(), [engine]);

  const [input, setInput] = useState('');

  const [forceEventId, setForceEventId] = useState(events[0]?.id ?? '');

  const [newPhrase, setNewPhrase] = useState('');

  const [newEventId, setNewEventId] = useState(events[0]?.id ?? '');

  const submitInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }
    engine.actions.submitText(input);
    setInput('');
  };

  const addCustomTrigger = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const phrases = newPhrase
      .split(/[,\n，]/)
      .map((phrase) => phrase.trim())
      .filter(Boolean);

    if (phrases.length === 0 || !newEventId) {
      return;
    }

    engine.actions.addCustomTrigger({
      phrasePatterns: phrases,
      eventId: newEventId,
      cooldownMs: QUICK_CUSTOM_TRIGGER_COOLDOWN_MS
    });
    setNewPhrase('');
  };

  return {
    events,
    input,
    setInput,
    forceEventId,
    setForceEventId,
    newPhrase,
    setNewPhrase,
    newEventId,
    setNewEventId,
    submitInput,
    addCustomTrigger
  };
}

export type DebugEventControls = ReturnType<typeof useDebugEventControls>;
