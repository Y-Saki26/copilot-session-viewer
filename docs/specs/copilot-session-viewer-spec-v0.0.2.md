# Copilot Session Viewer Current Specification

## Overview

- Version: 0.0.2
- Type: VS Code extension mockup
- Purpose: Scan GitHub Copilot Chat session logs under workspaceStorage and display session titles in a sidebar WebviewView.

## Entry Points

- Activity bar container: `copilotSessionViewer`
- View id: `copilotSessionViewer.sessionsView`
- Commands:
  - `copilotSessionViewer.refreshSessions`
  - `copilotSessionViewer.openSettings`

## Scan Sources

The extension scans `workspaceStorage` roots resolved from the following sources.

1. Bundled sample data under `resources/workspaceStorage` when `copilotSessionViewer.useBundledSampleData` is `true`.
2. User-configured additional roots from `copilotSessionViewer.workspaceStorageRoots`.

Configured roots support these path styles.

- `~`
- `%VAR%`
- `${env:VAR}`
- `$VAR`

Only existing roots are scanned. Missing roots are reported as warnings in the UI.

## Workspace Discovery

- Each immediate child directory under a resolved `workspaceStorage` root is treated as a workspace candidate.
- A candidate becomes scannable when it contains `chatSessions`.
- Workspace metadata is read from `workspace.json` when present.
- `folder` or `workspace` from `workspace.json` is normalized and used to derive:
  - workspace display name
  - workspace folder path
- When metadata is unavailable, the workspace hash directory name is used as the fallback name.

## Session Parsing

Supported file types:

- `.jsonl`
- `.json`

Parsing rules:

- `.json` files read `sessionId`, `customTitle`, `creationDate`, and `inputState.inputText`.
- `.jsonl` files scan all records and read:
  - `kind === 0` snapshot records for `sessionId`, `customTitle`, `creationDate`, `inputState.inputText`
  - `kind === 1` key updates for `customTitle` and `inputState.inputText`
- Title priority:
  1. `customTitle`
  2. First non-empty line of `inputText`
  3. Session file basename
- Fallback titles from input text are truncated to 50 characters.
- `updatedAt` is derived from the session file mtime.

## Sorting And Grouping

- Sessions are sorted by `updatedAt` descending, then by title ascending.
- The Webview groups sessions by workspace.
- Workspace groups are sorted by each group's newest session timestamp descending, then workspace name ascending.
- Each workspace group is collapsible.
- Collapsed state is persisted in Webview state per workspace key.

## UI Behavior

- The sidebar uses a WebviewView with a monospace font stack.
- Header actions:
  - Refresh
  - Settings
- Summary metrics show:
  - Source: `Cache` or `Live`
  - Roots
  - Workspaces
  - Sessions
  - Scanned timestamp
- Roots are listed in the summary area.
- Scan warnings are rendered in a dedicated warnings card.
- Empty scans render an explicit empty state message.

## Cache Behavior

- Scan results are cached in SQLite using `sql.js`.
- Cache file location: `globalStorageUri/session-cache.sqlite`
- Cached data includes:
  - metadata
  - scanned roots
  - warnings
  - normalized session rows
- On view initialization:
  1. Load cached results if present
  2. Render cached results immediately with `loadedFromCache = true`
  3. Run a fresh full scan
  4. Persist the new scan and re-render as live data
- Cache writes replace the full previous snapshot.

## Current Settings

- `copilotSessionViewer.useBundledSampleData`
  - Type: boolean
  - Default: `true`
- `copilotSessionViewer.workspaceStorageRoots`
  - Type: string array
  - Default: `[]`

## Build And Packaging

- Compile: `npm run compile`
- Watch: `npm run watch`
- Package: `npm run package:vsix`
- Packaging tool: `@vscode/vsce` 2.27.0
- SQLite runtime dependency: `sql.js`

## Packaging Caveats

- `resources/` is treated as reference material in this repository.
- `.vscodeignore` excludes `resources/**` from the VSIX package.
- As a result, bundled sample data under `resources/workspaceStorage` is available in the repository checkout, but not inside the packaged VSIX.
- Installed builds therefore depend on user-configured `workspaceStorage` roots for real data access.

## Current Limitations

- The extension is still a mockup and only lists session titles and metadata.
- Session bodies, messages, and detailed transcript browsing are not implemented.
- Scanning is full-scan based; there is no incremental file indexing yet.
- The SQLite cache is a last-scan snapshot cache, not a search index.