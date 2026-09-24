import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MainLlmDebugSink } from '../../../ai/llm/AiSdkClient';

/** Directory name, resolved against the writable root instead of the CWD. */
const DEBUG_DIRECTORY = '.local';

/**
 * Best-effort local inspection of each server-side main-model exchange.
 *
 * `dataRoot` is the writable root. The dump must never be resolved against the
 * working directory: once packaged the CWD is the read-only directory holding
 * the executable, so writing there would both litter the install folder and lose
 * the files on the next overwrite-install.
 */
export function createMainLlmDebugFiles(dataRoot = '.'): MainLlmDebugSink {
  const directory = path.resolve(dataRoot, DEBUG_DIRECTORY);
  const requestPath = path.join(directory, 'main-llm-request.json');
  const responsePath = path.join(directory, 'main-llm-response.json');

  return {
    writeRequest(request) {
      write(directory, requestPath, JSON.stringify(request, null, 2));
    },
    writeResponse(raw) {
      write(directory, responsePath, raw);
    }
  };
}

function write(directory: string, file: string, contents: string): void {
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, contents, 'utf8');
  } catch {
    // Diagnostics must not interrupt a conversation when the local disk is unavailable.
  }
}
