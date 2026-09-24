import type { TtsProvider, TtsSpeakOptions } from './types';

export class DisabledTtsProvider implements TtsProvider {
  readonly id = 'disabled';

  isSupported(): boolean {
    return false;
  }

  speak(_text: string, _options: TtsSpeakOptions = {}): Promise<void> {
    return Promise.resolve();
  }

  cancel(): void {}
}
