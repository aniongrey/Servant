---
name: shiro-action-runtime
description: Develop or debug Shiro semantic actions, VRMA loading, body-part composition, expressions, and event action steps. Use for work in the action, motion, controller, or event runtime; do not use for voice or live-message ingestion.
---

# Shiro Action Runtime

Keep changes inside the existing Character Drama Engine architecture and inspect only the layer relevant to the request.

## Route the change

- Semantic action definitions: `src/assets/actions/action-configs.json` and `src/engine/actions/ActionLoader.ts`.
- Multi-part playback and lifecycle: `src/engine/actions/ActionRuntime.ts`.
- VRMA loading, trimming, masks, mapping, or caching: `src/engine/motion/`.
- Expressions, spatial movement, or low-level playback: the matching file in `src/engine/controllers/`.
- Story/event behavior: `src/assets/events/` and `src/engine/event/`.
- Read `docs/project-v1.md` only when the requested behavior is not settled by these instructions or the nearby code and tests.

## Preserve these boundaries

- New story behavior uses an `action` step. Keep `motion` for low-level VRMA debugging and loader playback.
- AI-facing behavior selects semantic action IDs and an expression; it does not choose enter, hold, or exit phases.
- Compose actions across `Root`, `LowerBody`, `Torso`, `Head`, `LeftArm`, `RightArm`, and `Face` without introducing a new conflict system.
- Continuous actions follow enter, looping hold, and exit. A `oneShot` restores the prior action for its regions, or regional idle when none exists.
- Send facial state through `ExpressionController`, desktop position through `SpatialController`, and ordinary business playback through `ActionRuntime` rather than `BodyMotionController`.
- Keep action config fields within the V1 schema unless the user explicitly requests a schema change: `id`, `vrma`, `parts`, `oneShot`, `split`, and `emotion`.
- Use `default-character.json` `avatarFit.handIk` for actions containing arm tracks; do not recreate per-motion IK lists.

## Verify proportionally

Run the closest affected test first. For Runtime changes, run `npm run typecheck` and `npm test`. Run `npm run build` when real frontend or production-build behavior is involved. When visual playback matters, state the relevant manual combination from the development brief that still needs browser verification.
