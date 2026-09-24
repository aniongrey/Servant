---
name: shiro-verification
description: Select and run proportionate verification for Shiro repository code or asset changes, including targeted Vitest tests, TypeScript checks, builds, and clearly reported manual checks. Use when validating work or diagnosing test failures.
---

# Shiro Verification

Verify the requested change without modifying unrelated user work.

## Choose the smallest useful ladder

1. Inspect the requested scope and current diff with read-only Git commands. Treat pre-existing changes as user-owned.
2. Run the closest affected Vitest file or subsystem tests first when one exists.
3. Run `npm run typecheck` for TypeScript, runtime, configuration, or exported-type changes.
4. Run `npm test` for Runtime behavior or changes that cross subsystem boundaries.
5. Run `npm run build` for real frontend behavior, Vite configuration, asset resolution, or production-build changes.
6. Use `npm run dev` only when browser behavior needs manual verification; do not present server startup alone as proof that the behavior works.

Do not add snapshot-only or wording-matching tests when a behavioral assertion is available. Do not weaken tests to make a failure disappear.

## Diagnose failures

Identify whether a failure is caused by the requested change, an existing workspace change, missing local assets/services, or environment-specific browser behavior. Fix only failures within the user's requested scope. Report the exact failing command and the first actionable error when an in-scope fix is not authorized or possible.

## Report results

List commands that actually ran and distinguish automated passes from manual checks that remain. Mention skipped checks and the reason; never imply they passed.
