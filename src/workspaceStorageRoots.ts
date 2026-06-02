export const WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV = 'COPILOT_SESSION_VIEWER_WORKSPACE_STORAGE_ROOTS';

export function getDefaultVscodeUserStorageRoots(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32'
    ? ['%APPDATA%\\Code\\User']
    : ['~/.config/Code/User'];
}

export function getVscodeUserStorageRoots(
  configuredRoots: readonly string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  return configuredRoots.length > 0
    ? [...configuredRoots]
    : getDefaultVscodeUserStorageRoots(platform);
}

export function getWorkspaceStorageRoots(
  configuredRoots: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const override = environment[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV];
  if (override !== undefined) {
    const delimiter = platform === 'win32' ? ';' : ':';
    return override.split(delimiter).filter((root) => root.trim());
  }

  return [...configuredRoots];
}

export function hasWorkspaceStorageRootsOverride(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return environment[WORKSPACE_STORAGE_ROOTS_OVERRIDE_ENV] !== undefined;
}
