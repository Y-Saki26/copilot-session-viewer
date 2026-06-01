const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDefaultWorkspaceStorageRoots,
  getWorkspaceStorageRoots,
  WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV
} = require('../out/workspaceStorageRoots.js');

test('uses the Windows workspaceStorage root by default', () => {
  assert.deepEqual(getDefaultWorkspaceStorageRoots('win32'), [
    '%APPDATA%/Code/User/workspaceStorage'
  ]);
});

test('uses the UNIX-like workspaceStorage root by default', () => {
  assert.deepEqual(getDefaultWorkspaceStorageRoots('linux'), [
    '~/.config/Code/User/workspaceStorage'
  ]);
});

test('uses configured roots instead of the platform default', () => {
  assert.deepEqual(getWorkspaceStorageRoots(['/custom/workspaceStorage'], {}, 'linux'), [
    '/custom/workspaceStorage'
  ]);
});

test('uses the debug override instead of configured roots', () => {
  assert.deepEqual(
    getWorkspaceStorageRoots(
      ['C:/real/workspaceStorage'],
      { [WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV]: 'C:/repo/resources/workspaceStorage;D:/other/workspaceStorage' },
      'win32'
    ),
    [
      'C:/repo/resources/workspaceStorage',
      'D:/other/workspaceStorage'
    ]
  );
});
