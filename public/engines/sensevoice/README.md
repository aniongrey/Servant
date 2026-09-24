# SenseVoice runtime

The engine that turns microphone audio into text. It ships with the app; the
model it loads does not.

`offline-worker.js`, `sherpa-onnx-asr.js`, `sherpa-onnx-vad.js` and
`sherpa-onnx-wasm-main-vad-asr.{js,wasm}` come from the official
`sherpa-onnx-wasm-simd-1.13.2-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small`
package (https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.2) and must stay
from that same release. `audio-input-worklet.js` is ours.

`silero_vad_v5.onnx` and `silero_vad_legacy.onnx` are the Silero VAD exports from
the same release. No SenseVoice model repository ships them, which is why they are
the only model-shaped files still bundled: the backend serves them through the
resource manifest's `bundle` mirror, so voice activity detection keeps working
before anything has been downloaded.

Deliberately absent:

| File | Why |
| --- | --- |
| `model.int8.onnx`, `tokens.txt` | Downloaded into the directory the user picked. |
| `sherpa-onnx-wasm-main-vad-asr.data` | ~229MB duplicating those two files plus an unused Silero export. The glue treats it as a hard run dependency, so `offline-worker.js` answers emscripten's `getPreloadedPackage` hook with an empty buffer and the fetch never happens. |
| `sherpa-onnx-wasm-main-asr.{js,wasm}` | The ASR-only build of the same runtime. Nothing loads it. |

The worker fetches every model file through
`GET /api/provisioning/assets/<resource>/<file>` — the only way the webview can
read a directory outside the app — and mounts it into the WASM filesystem itself;
see `docs/provisioning.md`.

## Diffing against upstream

`git log` cannot show what we changed in this directory: `sherpa-onnx-vad.js` was
reformatted upstream-style at some point, and the Silero preset differs
functionally — ours is `maxSpeechDuration: 5`, upstream has `20`. A pristine copy
of the release's JS (no binaries) is kept at
`.local/upstream/sensevoice-wasm-1.13.2/` together with `SOURCE.md`, which records
the dropped `.data` hash and the exact diff. That directory is local-only and
gitignored; re-download the release tarball if it is gone.
