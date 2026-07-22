import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { NimClient } from '../src/llm/NimClient.js';
import { createSSEParser } from '../src/llm/sseParse.js';

describe('sseParse.createSSEParser', () => {
  test('parses complete events fed in one chunk', () => {
    const parser = createSSEParser();
    const events = parser.feed('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n');
    assert.deepEqual(events, [{ a: 1 }, { a: 2 }]);
    assert.equal(parser.isDone(), true);
  });

  test('buffers a partial line split across feed() calls', () => {
    const parser = createSSEParser();
    const first = parser.feed('data: {"a":1');
    assert.deepEqual(first, []);
    const second = parser.feed('}\n\n');
    assert.deepEqual(second, [{ a: 1 }]);
  });

  test('ignores malformed JSON lines without throwing', () => {
    const parser = createSSEParser();
    const events = parser.feed('data: not-json\n\ndata: {"a":1}\n\n');
    assert.deepEqual(events, [{ a: 1 }]);
  });

  test('ignores non-data lines', () => {
    const parser = createSSEParser();
    const events = parser.feed(': comment\nevent: message\ndata: {"a":1}\n\n');
    assert.deepEqual(events, [{ a: 1 }]);
  });
});

describe('NimClient streaming', () => {
  let server;
  let baseUrl;
  let lastRequestBody;

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastRequestBody = JSON.parse(body);
        if (lastRequestBody.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
          const chunks = [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo, "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
            'data: [DONE]\n\n',
          ];
          let i = 0;
          const interval = setInterval(() => {
            if (i >= chunks.length) {
              clearInterval(interval);
              res.end();
              return;
            }
            res.write(chunks[i++]);
          }, 5);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'non-streamed reply' } }] }));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }));

  test('without onToken: sends stream:false and returns the JSON content', async () => {
    const client = new NimClient({ baseUrl, model: 'test-model' });
    const result = await client.chatCompletion({ system: 'sys', messages: [] });
    assert.equal(lastRequestBody.stream, false);
    assert.equal(result, 'non-streamed reply');
  });

  test('with onToken: sends stream:true, fires deltas, resolves the concatenated text', async () => {
    const client = new NimClient({ baseUrl, model: 'test-model' });
    const deltas = [];
    const result = await client.chatCompletion({
      system: 'sys',
      messages: [],
      onToken: (delta) => deltas.push(delta),
    });
    assert.equal(lastRequestBody.stream, true);
    assert.deepEqual(deltas, ['Hel', 'lo, ', 'world!']);
    assert.equal(result, 'Hello, world!');
  });
});
