const assert = require('node:assert/strict');
const test = require('node:test');

const { ChatLogDecoder } = require('../out/chatLogDecoder.js');

test('decodeJsonLines applies set push splice and delete entries', () => {
  const contents = [
    JSON.stringify({
      kind: 0,
      v: {
        sessionId: 'unit-session',
        items: ['keep', 'remove-1', 'remove-2'],
        nested: {
          values: []
        }
      }
    }),
    JSON.stringify({ kind: 1, k: ['nested', 'label'], v: 'ready' }),
    JSON.stringify({ kind: 2, k: ['nested', 'values'], v: ['first', 'second'] }),
    JSON.stringify({ kind: 2, k: ['items'], i: 1, v: ['replacement', 'tail'] }),
    JSON.stringify({ kind: 3, k: ['nested', 'label'] })
  ].join('\n');

  const decoded = new ChatLogDecoder().decodeJsonLines(contents);

  assert.equal(decoded.lineCount, 5);
  assert.deepEqual(decoded.data.items, ['keep', 'replacement', 'tail']);
  assert.deepEqual(decoded.data.nested.values, ['first', 'second']);
  assert.equal(decoded.data.nested.label, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(decoded.data.nested, 'label'), true);
});

test('decodeJsonLines rejects logs without an initial entry', () => {
  const contents = JSON.stringify({ kind: 1, k: ['customTitle'], v: 'broken' });

  assert.throws(
    () => new ChatLogDecoder().decodeJsonLines(contents),
    /missing an initial entry/i
  );
});

test('decodeJsonLines rejects push operations on non-array targets', () => {
  const contents = [
    JSON.stringify({
      kind: 0,
      v: {
        sessionId: 'invalid-push',
        nested: {
          value: 'not-an-array'
        }
      }
    }),
    JSON.stringify({ kind: 2, k: ['nested', 'value'], v: ['unexpected'] })
  ].join('\n');

  assert.throws(
    () => new ChatLogDecoder().decodeJsonLines(contents),
    /non-array value/i
  );
});

test('decodeJsonSnapshot returns the parsed session object', () => {
  const contents = JSON.stringify({
    sessionId: 'snapshot-session',
    customTitle: 'Snapshot Title',
    requests: []
  });

  const decoded = new ChatLogDecoder().decodeJsonSnapshot(contents);

  assert.equal(decoded.sessionId, 'snapshot-session');
  assert.equal(decoded.customTitle, 'Snapshot Title');
  assert.deepEqual(decoded.requests, []);
});