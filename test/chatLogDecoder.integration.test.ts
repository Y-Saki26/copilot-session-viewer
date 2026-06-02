import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'vitest';

import { decodeChatLogFile } from '../src/chatLogDecoder';

const fixturePath = path.resolve(__dirname, 'fixtures', 'dummy-session.jsonl');
const realSessionTarget = process.env.COPILOT_SESSION_VIEWER_REAL_SESSION_LOG;

test('decodeChatLogFile decodes the dummy JSONL fixture', async () => {
  const decoded = await decodeChatLogFile(fixturePath);

  assert.equal(decoded.sessionId, 'fixture-session');
  assert.equal(decoded.customTitle, 'Fixture Session');
  const inputState = decoded.inputState;
  const requests = decoded.requests;
  assert.ok(inputState);
  assert.ok(requests);
  assert.ok(requests[0]);
  assert.ok(requests[0].response);
  assert.equal(inputState.inputText, 'Draft prompt for follow-up');
  assert.equal(decoded.debugFlag, undefined);
  assert.equal(Array.isArray(requests), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].message?.text, 'Summarize the decoder change');
  assert.equal(Array.isArray(requests[0].response), true);
  assert.equal(requests[0].response.length, 2);
});

test.skipIf(!realSessionTarget)(
  'decodeChatLogFile can decode a real session log selected by environment variable',
  async () => {
    const resolvedPath = await resolveSessionLogPath(realSessionTarget!);
    const decoded = await decodeChatLogFile(resolvedPath);

    const sessionId = decoded.sessionId;
    assert.equal(typeof sessionId, 'string');
    assert.ok(sessionId);
    assert.notEqual(sessionId.length, 0);
    assert.equal(Array.isArray(decoded.requests), true);
  }
);

async function resolveSessionLogPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  const stats = await fs.stat(resolved);

  if (stats.isFile()) {
    return resolved;
  }

  if (!stats.isDirectory()) {
    throw new Error(`Unsupported real session log target: ${resolved}`);
  }

  const sessionFile = await findFirstSessionFile(resolved);
  if (!sessionFile) {
    throw new Error(`No .jsonl or .json session log was found under ${resolved}`);
  }

  return sessionFile;
}

async function findFirstSessionFile(rootPath: string): Promise<string | undefined> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nestedMatch = await findFirstSessionFile(path.join(rootPath, entry.name));
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}
