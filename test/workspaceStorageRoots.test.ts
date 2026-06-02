const assert = require('node:assert/strict');
import { test } from 'vitest';

import {
  getDefaultVscodeUserStorageRoots,
  getVscodeUserStorageRoots,
  getWorkspaceStorageRoots,
  hasWorkspaceStorageRootsOverride,
  WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV
} from '../src/workspaceStorageRoots';

test('uses the Windows VS Code user storage root by default', () => {
  assert.deepEqual(getDefaultVscodeUserStorageRoots('win32'), [
    '%APPDATA%\\Code\\User'
  ]);
});

test('uses the UNIX-like VS Code user storage root by default', () => {
  assert.deepEqual(getDefaultVscodeUserStorageRoots('linux'), [
    '~/.config/Code/User'
  ]);
});

test('uses configured VS Code user storage roots instead of the platform default', () => {
  assert.deepEqual(getVscodeUserStorageRoots(['/custom/Code/User'], 'linux'), [
    '/custom/Code/User'
  ]);
});

test('does not add a platform default workspaceStorage root', () => {
  assert.deepEqual(getWorkspaceStorageRoots([], {}, 'linux'), []);
});

test('retains configured workspaceStorage roots as additional scan roots', () => {
  assert.deepEqual(getWorkspaceStorageRoots(['/custom/workspaceStorage'], {}, 'linux'), [
    '/custom/workspaceStorage'
  ]);
});

test('uses the debug override instead of configured roots', () => {
  assert.deepEqual(
    getWorkspaceStorageRoots(
      ['C:\\real\\workspaceStorage'],
      { [WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV]: 'C:\\repo\\resources\\workspaceStorage;D:\\other\\workspaceStorage' },
      'win32'
    ),
    [
      'C:\\repo\\resources\\workspaceStorage',
      'D:\\other\\workspaceStorage'
    ]
  );
});

test('detects whether the debug workspaceStorage override is present', () => {
  assert.equal(hasWorkspaceStorageRootsOverride({}), false);
  assert.equal(hasWorkspaceStorageRootsOverride({ [WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV]: '' }), true);
});
