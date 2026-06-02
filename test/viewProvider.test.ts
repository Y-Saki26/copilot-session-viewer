import type * as vscode from 'vscode';
import { expect, test, vi } from 'vitest';

import type { OutputLogger } from '../src/outputLogger';
import type { ScanSummary, WorkspaceSummary } from '../src/types';

vi.mock('vscode', () => ({}));

import { SessionsViewProvider } from '../src/viewProvider';

interface ProviderInternals {
  scanner: {
    readWorkspaceSessions: ReturnType<typeof vi.fn>;
  };
  lastScan: ScanSummary;
  view: {
    webview: {
      postMessage: ReturnType<typeof vi.fn>;
    };
  };
  scanGeneration: number;
  workspaceSessions: Map<string, unknown[]>;
  workspacePreload?: Promise<void>;
  loadWorkspaceSessions(chatSessionsDir: string): Promise<void>;
  startWorkspaceSessionsPreload(): void;
}

const emptyLoadResult = { sessions: [], warnings: [] };

test('preloads workspace session lists sequentially', async () => {
  const first = createDeferred<typeof emptyLoadResult>();
  const second = createDeferred<typeof emptyLoadResult>();
  const provider = createProvider([workspace('first'), workspace('second')]);
  const calls: string[] = [];

  provider.scanner.readWorkspaceSessions = vi.fn((value: WorkspaceSummary) => {
    calls.push(value.chatSessionsDir);
    return value.chatSessionsDir === 'first' ? first.promise : second.promise;
  });

  provider.startWorkspaceSessionsPreload();
  expect(calls).toEqual(['first']);

  first.resolve(emptyLoadResult);
  await flushPromises();
  expect(calls).toEqual(['first', 'second']);

  second.resolve(emptyLoadResult);
  await provider.workspacePreload;
  expect(calls).toEqual(['first', 'second']);
});

test('reuses an in-flight preload when the same workspace is expanded', async () => {
  const load = createDeferred<typeof emptyLoadResult>();
  const provider = createProvider([workspace('shared')]);

  provider.scanner.readWorkspaceSessions = vi.fn(() => load.promise);

  provider.startWorkspaceSessionsPreload();
  const expansion = provider.loadWorkspaceSessions('shared');
  expect(provider.scanner.readWorkspaceSessions).toHaveBeenCalledTimes(1);

  load.resolve(emptyLoadResult);
  await expansion;
  await provider.workspacePreload;
  expect(provider.scanner.readWorkspaceSessions).toHaveBeenCalledTimes(1);
});

test('discards a workspace preload result from an older scan generation', async () => {
  const load = createDeferred<typeof emptyLoadResult>();
  const provider = createProvider([workspace('stale')]);

  provider.scanner.readWorkspaceSessions = vi.fn(() => load.promise);

  provider.startWorkspaceSessionsPreload();
  provider.scanGeneration += 1;
  load.resolve(emptyLoadResult);
  await provider.workspacePreload;

  expect(provider.workspaceSessions.has('stale')).toBe(false);
  expect(provider.view.webview.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'workspaceSessionsLoaded' })
  );
});

function createProvider(workspaces: WorkspaceSummary[]): ProviderInternals {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
  const provider = new SessionsViewProvider({} as vscode.ExtensionContext, logger as unknown as OutputLogger) as unknown as ProviderInternals;

  provider.lastScan = {
    rootsScanned: [],
    workspaceCount: workspaces.length,
    sessionCount: workspaces.reduce((count, value) => count + value.sessionCount, 0),
    workspaces,
    warnings: [],
    scannedAt: Date.now()
  };
  provider.view = {
    webview: {
      postMessage: vi.fn(async () => true)
    }
  };

  return provider;
}

function workspace(chatSessionsDir: string): WorkspaceSummary {
  return {
    workspaceHash: chatSessionsDir,
    workspaceName: chatSessionsDir,
    chatSessionsDir,
    sessionCount: 1
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
