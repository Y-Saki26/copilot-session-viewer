import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';

import { WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV } from '../src/workspaceStorageRoots';

const { configurationValues } = vi.hoisted(() => ({
  configurationValues: new Map<string, string[]>()
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: string[]) => configurationValues.get(key) ?? fallback
    })
  }
}));

import { CopilotSessionScanner } from '../src/logScanner';

const originalWorkspaceStorageOverride = process.env[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV];
const temporaryDirectories: string[] = [];

beforeEach(() => {
  configurationValues.clear();
  delete process.env[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV];
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

afterAll(() => {
  if (originalWorkspaceStorageOverride === undefined) {
    delete process.env[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV];
  } else {
    process.env[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV] = originalWorkspaceStorageOverride;
  }
});

test('scans workspace and empty-window sessions below a VS Code user storage root', async () => {
  const userStorageRoot = await createTemporaryDirectory();
  const workspaceDirectory = path.join(userStorageRoot, 'workspaceStorage', 'workspace-hash');
  const workspaceSessionsDirectory = path.join(workspaceDirectory, 'chatSessions');
  const emptyWindowSessionsDirectory = path.join(userStorageRoot, 'globalStorage', 'emptyWindowChatSessions');

  await fs.mkdir(workspaceSessionsDirectory, { recursive: true });
  await fs.mkdir(emptyWindowSessionsDirectory, { recursive: true });
  await fs.writeFile(path.join(workspaceDirectory, 'workspace.json'), JSON.stringify({ folder: 'file:///C:/work/sample-project' }));
  await fs.writeFile(path.join(workspaceSessionsDirectory, 'workspace-session.jsonl'), '{}');
  await fs.writeFile(path.join(emptyWindowSessionsDirectory, 'empty-window-session.jsonl'), '{}');
  configurationValues.set('vscodeUserStorageRoots', [userStorageRoot]);

  const summary = await new CopilotSessionScanner().scan();

  expect(summary.rootsScanned).toEqual([userStorageRoot]);
  expect(summary.sessionCount).toBe(2);
  expect(summary.workspaces).toEqual([
    expect.objectContaining({
      workspaceHash: 'empty-window',
      workspaceName: 'Empty Window',
      chatSessionsDir: emptyWindowSessionsDirectory,
      sessionCount: 1
    }),
    expect.objectContaining({
      workspaceHash: 'workspace-hash',
      workspaceName: 'sample-project',
      chatSessionsDir: workspaceSessionsDirectory,
      sessionCount: 1
    })
  ]);
});

test('scans an additional workspaceStorage root directly for sample data', async () => {
  const userStorageRoot = await createTemporaryDirectory();
  const sampleWorkspaceStorageRoot = await createTemporaryDirectory();
  const sampleSessionsDirectory = path.join(sampleWorkspaceStorageRoot, 'sample-hash', 'chatSessions');

  await fs.mkdir(sampleSessionsDirectory, { recursive: true });
  await fs.writeFile(path.join(sampleSessionsDirectory, 'sample-session.json'), '{}');
  configurationValues.set('vscodeUserStorageRoots', [userStorageRoot]);
  configurationValues.set('workspaceStorageRoots', [sampleWorkspaceStorageRoot]);

  const summary = await new CopilotSessionScanner().scan();

  expect(summary.rootsScanned).toEqual([userStorageRoot, sampleWorkspaceStorageRoot]);
  expect(summary.workspaces).toEqual([
    expect.objectContaining({
      workspaceHash: 'sample-hash',
      workspaceName: 'sample-hash',
      chatSessionsDir: sampleSessionsDirectory,
      sessionCount: 1
    })
  ]);
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-session-viewer-'));
  temporaryDirectories.push(directory);
  return directory;
}
