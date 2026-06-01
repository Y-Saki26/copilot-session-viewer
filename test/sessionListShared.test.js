const assert = require('node:assert/strict');
const test = require('node:test');

test('filterVisibleSessions hides empty sessions by default', async () => {
  const { filterVisibleSessions } = await import('../media/sessionListShared.mjs');
  const sessions = [
    { id: 'with-requests', isEmpty: false },
    { id: 'empty', isEmpty: true }
  ];

  assert.deepEqual(filterVisibleSessions(sessions, false), [
    { id: 'with-requests', isEmpty: false }
  ]);
  assert.deepEqual(filterVisibleSessions(sessions, true), sessions);
});
