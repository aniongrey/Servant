import { expect, it } from 'vitest';
import {
  attachVisemeAnalyzerTo,
  prepareVisemeAnalyzer,
  readLiveVisemeWeights,
  unlockVisemeAnalyzer
} from './visemeAnalyzer';

/**
 * The contract that matters for a page that cannot analyse audio (no
 * `AudioContext`, no `AudioWorklet`, a non-secure context — which is what a test
 * runner and an unsupported browser look like): everything degrades to "no
 * weights" instead of throwing, so spoken audio keeps playing and the caller
 * keeps its own mouth motion.
 */
it('degrades to no analysis when the page cannot analyse audio', () => {
  prepareVisemeAnalyzer();

  expect(readLiveVisemeWeights()).toBeNull();
  expect(attachVisemeAnalyzerTo({} as HTMLMediaElement, '')).toBeNull();
  expect(() => unlockVisemeAnalyzer()).not.toThrow();
});
