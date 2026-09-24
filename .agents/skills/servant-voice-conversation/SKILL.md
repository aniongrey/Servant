---
name: servant-voice-conversation
description: Develop or debug Servant microphone capture, SenseVoice recognition, VAD interruption, LLM conversation, personality, streaming replies, language conversion, or TTS. Do not use for the live-message queue.
---

# Servant Voice Conversation

Start from the narrowest affected layer and its colocated tests. Read only the relevant heading in `docs/voice-realtime-sensevoice.md` when changing pipeline behavior, model configuration, interruption semantics, or browser deployment requirements.

## Route the change

- Microphone, VAD, resampling, worker messages, and offline recognition: `src/engine/conversation/SherpaSpeechRecognition.ts` plus `public/models/sherpa-asr/`.
- Conversation UI, request cancellation, and streaming state: `src/chat/CompanionChatPanel.tsx`.
- Provider configuration, structured intent, prompts, and translation fallback: `src/engine/conversation/LlmConfig.ts` and `AiSdkClient.ts`.
- Personality and follow-ups: `PersonalitySystem.ts` and `FollowUpPolicy.ts`.
- Segmentation, provider selection, playback, and interruption: `src/engine/tts/`.
- Network proxy behavior: `src/network/` and the relevant Vite proxy configuration.

## Preserve these boundaries

- Keep the recognition path singular: 16 kHz AudioWorklet frames -> Silero VAD -> complete utterance -> SenseVoiceSmall ONNX int8 decode.
- Do not reintroduce browser streaming ASR, Zipformer partial recognition, two-pass correction, or UI-adjustable VAD settings unless explicitly requested.
- `speech-start` interrupts an active LLM request and clears unfinished reply/follow-up state; `speech-end` commits one final decoded utterance. Manual recording commits only when manually stopped.
- Preloading must not request microphone permission.
- Preserve cross-origin isolation requirements for pthread/`SharedArrayBuffer` deployments.
- Visible chat/history/personality logic uses Chinese `speech`. `ttsSpeech` is a read-aloud translation only and must not enter conversation history.
- Keep cancellation and stale-result protection intact across ASR, LLM, translation fallback, and TTS turns.

## Verify proportionally

Run tests closest to the changed conversation or TTS module, then `npm run typecheck` and `npm test`. Use `npm run dev` for microphone, interruption, audio, or browser-header behavior and report any manual verification that cannot be automated.
