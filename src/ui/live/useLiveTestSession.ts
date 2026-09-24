import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BarrageGrabAdapter,
  type BarrageGrabStatus
} from '../../integrations/barrage/adapters/BarrageGrabAdapter';
import { liveConfig } from '../../integrations/barrage/config/live.config';
import { createHarness } from './liveTestHarness';

/** One resettable test session owns the socket, scheduler, and runtime notifications. */
export function useLiveTestSession() {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [generation, setGeneration] = useState(0);
  const harness = useMemo(() => createHarness(), [generation]);
  const [autoTick, setAutoTick] = useState(true);
  const [wsUrl, setWsUrl] = useState(liveConfig.barrageGrab.url);
  const [socketStatus, setSocketStatus] = useState<BarrageGrabStatus>('disconnected');
  const adapterRef = useRef<BarrageGrabAdapter | undefined>(undefined);

  useEffect(() => {
    let active = true;
    harness.setOnChange(refresh);
    void harness.system
      .initialize()
      .then(() => {
        if (active) refresh();
      })
      .catch((error) => {
        if (!active) return;
        harness.addActivity('LIVE_ERROR', error instanceof Error ? error.message : '初始化失败');
        refresh();
      });
    return () => {
      active = false;
      harness.setOnChange(undefined);
      harness.system.controller.stop();
      adapterRef.current?.disconnect();
      adapterRef.current = undefined;
    };
  }, [harness]);

  useEffect(() => {
    if (!autoTick) return;
    const timer = window.setInterval(() => void harness.tick(), liveConfig.controller.tickIntervalMs);
    return () => window.clearInterval(timer);
  }, [autoTick, harness]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSocketStatus(adapterRef.current?.getStatus() ?? 'disconnected');
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  function disconnectSocket() {
    adapterRef.current?.disconnect();
    adapterRef.current = undefined;
    setSocketStatus('disconnected');
  }

  function connectSocket() {
    disconnectSocket();
    const adapter = new BarrageGrabAdapter(harness.system.normalizer, {
      ...liveConfig,
      barrageGrab: { ...liveConfig.barrageGrab, url: wsUrl.trim() || liveConfig.barrageGrab.url }
    });
    adapter.onRawEvent(harness.ingest);
    adapterRef.current = adapter;
    adapter.connect();
    setSocketStatus(adapter.getStatus());
  }

  function resetSession() {
    disconnectSocket();
    setGeneration((value) => value + 1);
  }

  return {
    harness,
    refresh,
    autoTick,
    setAutoTick,
    wsUrl,
    setWsUrl,
    socketStatus,
    connectSocket,
    disconnectSocket,
    resetSession,
    ingest: harness.ingest
  };
}
