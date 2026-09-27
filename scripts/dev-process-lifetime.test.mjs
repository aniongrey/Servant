import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { stopProcessTree } from './dev-process-lifetime.mjs';

test('killing the launcher releases its child listener', { timeout: 15000 }, async () => {
  const guard = new URL('./dev-process-lifetime.mjs', import.meta.url).href;
  const childCode = `
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({
      pid: process.pid, port: server.address().port
    })));
  `;
  const parent = spawn(process.execPath, ['-e', `
    require('node:child_process').spawn(process.execPath,
      ${JSON.stringify(['--import', guard, '-e', childCode])},
      { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: true });
  `], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let child;
  try {
    child = await new Promise((resolve, reject) => {
      let output = '';
      parent.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('\n')) resolve(JSON.parse(output.trim()));
      });
      parent.once('error', reject);
      parent.once('exit', () => reject(new Error('launcher exited before listening')));
    });
    assert.ok(child, 'child must bind its port');
    const exited = once(parent, 'exit');
    // Node's Windows kill also terminates descendants; taskkill without /T
    // reproduces a launcher disappearing while its listener survives.
    if (process.platform === 'win32') {
      const killed = spawnSync('taskkill', ['/PID', String(parent.pid), '/F'], { windowsHide: true });
      assert.equal(killed.status, 0, killed.stderr?.toString());
    } else {
      parent.kill('SIGKILL');
    }
    await exited;
    let alive = true;
    for (let attempt = 0; attempt < 50 && alive; attempt++) {
      await delay(100);
      try { process.kill(child.pid, 0); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        alive = false;
      }
    }
    assert.equal(alive, false, 'orphan must exit without manual cleanup');
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(child.port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) stopProcessTree(parent.pid);
    parent.stdout.destroy();
    parent.stderr.destroy();
    if (child) {
      try { process.kill(child.pid, 0); stopProcessTree(child.pid); } catch {}
    }
  }
});
