---
name: servant-live-interaction
description: Develop or debug Servant livestream event ingestion, BarrageGrab connectivity, normalization, filtering, aggregation, priority, TTL queues, scheduling, or the live test page. Do not use for ordinary microphone conversation.
---

# Servant Live Interaction

Keep the livestream pipeline deterministic and independent from the character runtime. Read only the relevant section of `docs/live-interaction-v1.md` when changing a rule, score, TTL, queue behavior, adapter contract, or manual test scenario.

## Follow the pipeline

Trace changes in this order:

`BarrageGrabAdapter -> LiveEventNormalizer -> BlacklistManager -> LiveContentFilter -> DuplicateAggregator -> LivePriorityCalculator -> LiveEventQueue -> LiveController -> LiveEventConsumer`

Inspect the matching directory under `src/live/` and its closest tests before opening unrelated character-engine code.

## Preserve these boundaries

- Connect the live system to character behavior only through `LiveEventConsumer`; do not make `src/live/` depend directly on `CharacterStateManager`, `ActionRuntime`, or TTS implementations.
- Process blacklists before content filters, and content filters before aggregation and priority.
- Feed each raw adapter message into the system once. Do not subscribe both `onRawEvent` and `onEvent` to the same ingestion path.
- Preserve one queue position for equivalent aggregated danmaku and retain count, unique-user, and timing metadata.
- HIGH can bypass normal cooldown, NORMAL observes cooldown, and LOW remains observational in V1.
- Expired events must be removed before scheduling. Speech occupancy is communicated through `LiveController.onSpeechStart()` and `onSpeechEnd()`.
- Keep advanced user profiles, LLM moderation, cross-stream memory, and complex fairness outside the V1 pipeline unless explicitly requested.

## Verify proportionally

Run the closest `src/live/**/*.test.ts` tests, then `npm run typecheck` and `npm test`. Run `npm run build` for adapter/demo-page or production integration changes. For UI or queue timing behavior, use `live-test.html` and report the specific documented scenario checked.
