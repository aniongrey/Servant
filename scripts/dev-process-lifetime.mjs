// Loaded by every development entry point and Vite child. Windows does not
// automatically terminate children when a terminal or its parent is killed.
import { spawnSync } from 'node:child_process';

export function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true
    });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

const parentPid = process.ppid;
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch (error) {
    if (error.code !== 'ESRCH') return;
    stopProcessTree(process.pid);
    process.exit(0);
  }
}, 1000).unref();
