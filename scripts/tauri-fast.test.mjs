import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { waitForDesktop } from './tauri-fast.mjs';

test('waits through missing pages and a warming API; rejects HTML fallback and times out', async () => {
  let pages = 0;
  let apis = 0;
  let fallback = false;
  const server = createServer((request, response) => {
    if (request.url === '/pages/desktop.html') {
      response.setHeader('Content-Type', 'text/html');
      if (++pages < 3) response.writeHead(404).end('not built yet');
      else response.end(fallback ? '<html>other page</html>' : '<script src="/assets/desktop-test.js"></script>');
    } else {
      if (++apis < 3) response.writeHead(503).end('warming');
      else response.end(JSON.stringify({ setupRequired: false }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await waitForDesktop(url, AbortSignal.timeout(3000), 5);
    assert.equal(pages, 5);
    assert.equal(apis, 3);
    fallback = true;
    await assert.rejects(waitForDesktop(url, AbortSignal.timeout(100), 5));
    assert.equal(apis, 3, 'an unrelated HTML page must not pass readiness');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
