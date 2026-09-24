import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSpeech } from '@speech-sdk/core';
import { playAudioBytes } from './audioPlayback';
import { generateDoubaoSpeech, parseDoubaoV3Frame, SpeechSdkTtsProvider } from './SpeechSdkTtsProvider';
import { createDefaultSpeechSdkConfigForProvider } from './speechSdkTtsConfig';

vi.mock('@speech-sdk/core', () => ({ generateSpeech: vi.fn() }));
vi.mock('./audioPlayback', () => ({
  createTtsAbortError: () => new DOMException('Speech playback was aborted', 'AbortError'),
  playAudioBytes: vi.fn()
}));

describe('Speech SDK provider rendering', () => {
  const generateSpeechMock = vi.mocked(generateSpeech);
  const playAudioBytesMock = vi.mocked(playAudioBytes);

  function createProvider(): SpeechSdkTtsProvider {
    return new SpeechSdkTtsProvider({
      ...createDefaultSpeechSdkConfigForProvider('openai'),
      apiKey: 'test-key'
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    generateSpeechMock.mockResolvedValue({
      audio: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' }
    } as never);
    playAudioBytesMock.mockResolvedValue(undefined);
  });

  it('renders audio without playing it, and replays it without a second request', async () => {
    const provider = createProvider();

    const prepared = await provider.prepare('你好。');
    expect(prepared).toEqual({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' });
    expect(generateSpeechMock).toHaveBeenCalledOnce();
    expect(playAudioBytesMock).not.toHaveBeenCalled();

    const onPlaybackStart = vi.fn();
    await provider.play(prepared, { onPlaybackStart });

    expect(generateSpeechMock).toHaveBeenCalledOnce();
    expect(playAudioBytesMock).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: prepared.bytes, mediaType: 'audio/mpeg', onPlaybackStart })
    );
  });

  it('keeps speak as render-then-play', async () => {
    await createProvider().speak('你好。');

    expect(generateSpeechMock).toHaveBeenCalledOnce();
    expect(playAudioBytesMock).toHaveBeenCalledOnce();
  });

  it('refuses to start playback through an aborted signal', async () => {
    const provider = createProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.play(
        { bytes: new Uint8Array([1]), mediaType: 'audio/mpeg' },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(playAudioBytesMock).not.toHaveBeenCalled();
  });
});

describe('Doubao TTS provider', () => {
  it('extracts raw audio bytes from a V3 TTSResponse frame', () => {
    expect([...parseDoubaoV3Frame(buildV3ServerFrame(352, new Uint8Array([1, 2, 3]))).payload]).toEqual([
      1, 2, 3
    ]);
  });

  it('decodes Base64 audio from a JSON V3 response frame', () => {
    const payload = new TextEncoder().encode(JSON.stringify({ data: btoa(String.fromCharCode(4, 5, 6)) }));
    expect([...parseDoubaoV3Frame(buildV3ServerFrame(352, payload, 1)).payload]).toEqual([4, 5, 6]);
  });

  it('sends the official v1 HTTP payload and decodes returned audio', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 0,
            message: 'Success',
            audio: btoa(String.fromCharCode(1, 2, 3))
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    );
    const config = {
      ...createDefaultSpeechSdkConfigForProvider('doubao'),
      appId: 'test-app-id',
      apiKey: 'test-access-token',
      voice: 'custom-speaker-id',
      speed: 1.2
    };

    const result = await generateDoubaoSpeech(
      config,
      '你好，豆包。',
      new AbortController().signal,
      fetchMock as unknown as typeof globalThis.fetch
    );

    expect(result.mediaType).toBe('audio/mpeg');
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/create');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'test-access-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'seed-tts-2.0',
      text_prompt: '你好，豆包。',
      references: [{ speaker: 'custom-speaker-id' }],
      audio_config: { format: 'mp3', sample_rate: 48000, speech_rate: 20, loudness_rate: 0, pitch_rate: 0 }
    });
  });

  it('surfaces the service error message', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 3050,
            message: 'voice type not found'
          }),
          { status: 200 }
        )
    );
    const config = {
      ...createDefaultSpeechSdkConfigForProvider('doubao'),
      appId: 'test-app-id',
      apiKey: 'test-access-token'
    };

    await expect(
      generateDoubaoSpeech(
        config,
        'test',
        new AbortController().signal,
        fetchMock as unknown as typeof globalThis.fetch
      )
    ).rejects.toThrow('voice type not found');
  });
});

function buildV3ServerFrame(event: number, payload: Uint8Array, serialization = 0): Uint8Array {
  const session = new TextEncoder().encode('test-session');
  const frame = new Uint8Array(16 + session.length + payload.length);
  frame.set([0x11, serialization === 0 ? 0xb4 : 0x94, serialization << 4, 0x00]);
  const view = new DataView(frame.buffer);
  view.setUint32(4, event, false);
  view.setUint32(8, session.length, false);
  frame.set(session, 12);
  view.setUint32(12 + session.length, payload.length, false);
  frame.set(payload, 16 + session.length);
  return frame;
}
