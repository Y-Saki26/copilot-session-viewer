import * as vscode from 'vscode';

import { mapChatSessionDocument } from './chatDocumentMapper';
import { CopilotSessionScanner } from './logScanner';
import { OutputLogger } from './outputLogger';
import { ScanCacheRepository } from './scanCacheRepository';
import { SessionPanel } from './sessionPanel';
import { ScanSummary, SessionSummary, WorkspaceSummary } from './types';

export class SessionsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'copilotSessionViewer.sessionsView';

  private view?: vscode.WebviewView;
  private readonly scanner = new CopilotSessionScanner();
  private readonly cacheRepository: ScanCacheRepository;
  private readonly sessionPanel: SessionPanel;
  private readonly workspaceSessions = new Map<string, SessionSummary[]>();
  private readonly workspaceLoads = new Map<string, Promise<void>>();
  private workspacePreload?: Promise<void>;
  private scanGeneration = 0;
  private isRefreshing = false;
  private lastScan?: ScanSummary;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: OutputLogger
  ) {
    this.cacheRepository = new ScanCacheRepository(context);
    this.sessionPanel = new SessionPanel(context, logger);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.logger.info('Sessions view resolved.');
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
      ]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    void this.initialize();
  }

  public async refresh(): Promise<void> {
    if (this.isRefreshing) {
      this.logger.info('Workspace scan skipped because another scan is already in progress.');
      return;
    }

    this.isRefreshing = true;
    try {
      this.scanGeneration += 1;
      if (this.workspacePreload) {
        this.workspacePreload = undefined;
        this.postMessage({ type: 'workspaceSessionsPreloadCompleted', value: { cancelled: true } });
      }
      const startedAt = Date.now();
      this.logger.info('Starting workspace scan.');
      this.workspaceSessions.clear();
      this.workspaceLoads.clear();
      const scan = await this.scanner.scan();
      await this.cacheRepository.save(scan);
      this.lastScan = scan;
      this.logger.info(`Workspace scan completed in ${Date.now() - startedAt}ms. Workspaces=${scan.workspaceCount}, Sessions=${scan.sessionCount}, Warnings=${scan.warnings.length}.`);
      this.logWarnings('Scan', scan.warnings);
      this.postMessage({ type: 'scanResult', value: scan });
    } catch (error) {
      this.logger.error('Workspace scan failed.', error);
      void vscode.window.showErrorMessage(this.errorMessage(error, 'Copilot Session Viewer failed to scan logs.'));
      this.postMessage({
        type: 'scanError',
        value: this.errorMessage(error, 'Failed to scan session logs.')
      });
    } finally {
      this.isRefreshing = false;
    }
  }

  private async initialize(): Promise<void> {
    try {
      this.logger.info('Loading cached scan result.');
      const cachedScan = await this.cacheRepository.load();
      if (cachedScan) {
        this.lastScan = cachedScan;
        this.logger.info(`Cached scan loaded. Workspaces=${cachedScan.workspaceCount}, Sessions=${cachedScan.sessionCount}.`);
        this.postMessage({ type: 'scanResult', value: cachedScan });
      } else {
        this.logger.info('No cached scan result was found.');
      }
    } catch (error) {
      this.logger.warn(this.errorMessage(error, 'Failed to load scan cache.'));
    }

    await this.refresh();
  }

  private handleMessage(message: unknown): void {
    if (!this.isObject(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.logger.info('Sessions webview is ready.');
        if (this.lastScan) {
          this.postMessage({ type: 'scanResult', value: this.lastScan });
        }
        return;
      case 'refresh':
        this.logger.info('Refresh requested from webview.');
        void this.refresh();
        return;
      case 'openSettings':
        this.logger.info('Settings requested from webview.');
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'copilotSessionViewer.vscodeUserStorageRoots'
        );
        return;
      case 'selectSession':
        if (this.isSessionSummary(message.session)) {
          this.logger.info(`Session selected: ${message.session.title} (${message.session.sourcePath}).`);
          void this.openSession(message.session);
          return;
        }

        if (typeof message.sourcePath === 'string') {
          const summary = this.findSessionSummary(message.sourcePath);
          if (summary) {
            this.logger.info(`Session selected by path lookup: ${summary.title} (${summary.sourcePath}).`);
            void this.openSession(summary);
          } else {
            this.logger.warn(`Session selection ignored because metadata was not found for ${message.sourcePath}.`);
          }
        }
        return;
      case 'loadWorkspaceSessions':
        if (typeof message.chatSessionsDir === 'string') {
          this.logger.info(`Workspace session list requested: ${message.chatSessionsDir}.`);
          void this.loadWorkspaceSessions(message.chatSessionsDir);
        }
        return;
      case 'loadAllWorkspaceSessions':
        this.logger.info('Sequential workspace session preload requested.');
        this.startWorkspaceSessionsPreload();
        return;
      case 'clientLog':
        this.logClientMessage(message.value);
        return;
      default:
        return;
    }
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css'));
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Copilot Session Viewer</title>
  </head>
  <body data-view="sessions">
    <div class="app">
      <header class="hero">
        <div>
          <p class="eyebrow">Local Chat History</p>
          <h1>Copilot Session Viewer</h1>
          <p class="subtitle">Scan local VS Code chat history, choose a session from the list, and open the restored conversation in a main panel.</p>
        </div>
        <div class="actions">
          <button id="refreshButton">Refresh</button>
          <button id="loadAllButton" class="secondary" title="Load session summaries for every workspace sequentially" disabled>Load all</button>
          <button id="settingsButton" class="secondary">Settings</button>
        </div>
        <label class="toggle">
          <input id="showEmptySessionsCheckbox" type="checkbox" />
          <span>Show empty sessions</span>
        </label>
      </header>
      <section id="summary" class="summary"></section>
      <section id="warnings" class="warnings"></section>
      <section id="sessions" class="sessions"></section>
    </div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private async openSession(summary: SessionSummary): Promise<void> {
    this.logger.info(`Restoring session log: ${summary.title} (${summary.sourcePath}).`);
    this.sessionPanel.showLoading(summary);

    try {
      const data = await this.scanner.readSessionData(summary.sourcePath);
      const document = mapChatSessionDocument(summary, data);
      this.logger.info(`Session restored: ${document.title}. Turns=${document.turns.length}.`);
      this.sessionPanel.showDocument(document);
    } catch (error) {
      this.logger.error(`Session restore failed for ${summary.sourcePath}.`, error);
      const message = this.errorMessage(error, 'Failed to restore session log.');
      this.sessionPanel.showError(summary.title, message);
      void vscode.window.showErrorMessage(message);
    }
  }

  private findSessionSummary(sourcePath: string): SessionSummary | undefined {
    for (const sessions of this.workspaceSessions.values()) {
      const match = sessions.find((session) => session.sourcePath === sourcePath);
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private async loadWorkspaceSessions(chatSessionsDir: string): Promise<void> {
    const cachedSessions = this.workspaceSessions.get(chatSessionsDir);
    if (cachedSessions) {
      this.logger.info(`Workspace session list served from memory cache: ${chatSessionsDir}. Sessions=${cachedSessions.length}.`);
      this.postMessage({
        type: 'workspaceSessionsLoaded',
        value: {
          chatSessionsDir,
          sessions: cachedSessions,
          warnings: []
        }
      });
      return;
    }

    const inflight = this.workspaceLoads.get(chatSessionsDir);
    if (inflight) {
      this.logger.info(`Workspace session load already in progress: ${chatSessionsDir}.`);
      await inflight;
      return;
    }

    const workspace = this.findWorkspaceSummary(chatSessionsDir);
    if (!workspace) {
      this.logger.warn(`Workspace session load skipped because metadata was not found: ${chatSessionsDir}.`);
      this.postMessage({
        type: 'workspaceSessionsError',
        value: {
          chatSessionsDir,
          message: `Failed to find workspace metadata for ${chatSessionsDir}.`
        }
      });
      return;
    }

    const generation = this.scanGeneration;
    const loadTask = this.loadWorkspaceSessionsInternal(workspace, generation);
    this.workspaceLoads.set(chatSessionsDir, loadTask);

    try {
      await loadTask;
    } finally {
      if (this.workspaceLoads.get(chatSessionsDir) === loadTask) {
        this.workspaceLoads.delete(chatSessionsDir);
      }
    }
  }

  private async loadWorkspaceSessionsInternal(workspace: WorkspaceSummary, generation: number): Promise<void> {
    try {
      const startedAt = Date.now();
      const result = await this.scanner.readWorkspaceSessions(workspace);
      if (generation !== this.scanGeneration) {
        this.logger.info(`Discarding stale workspace session list after refresh: ${workspace.chatSessionsDir}.`);
        return;
      }
      this.workspaceSessions.set(workspace.chatSessionsDir, result.sessions);
      this.logger.info(`Workspace session list loaded in ${Date.now() - startedAt}ms: ${workspace.workspaceName} (${workspace.chatSessionsDir}). Sessions=${result.sessions.length}, Warnings=${result.warnings.length}.`);
      this.logWarnings(`Workspace ${workspace.workspaceName}`, result.warnings);
      this.postMessage({
        type: 'workspaceSessionsLoaded',
        value: {
          chatSessionsDir: workspace.chatSessionsDir,
          sessions: result.sessions,
          warnings: result.warnings
        }
      });
    } catch (error) {
      if (generation !== this.scanGeneration) {
        this.logger.info(`Discarding stale workspace session load error after refresh: ${workspace.chatSessionsDir}.`);
        return;
      }
      this.logger.error(`Workspace session load failed: ${workspace.chatSessionsDir}.`, error);
      this.postMessage({
        type: 'workspaceSessionsError',
        value: {
          chatSessionsDir: workspace.chatSessionsDir,
          message: this.errorMessage(error, 'Failed to load workspace sessions.')
        }
      });
    }
  }

  private startWorkspaceSessionsPreload(): void {
    if (this.isRefreshing) {
      this.logger.info('Sequential workspace session preload skipped because a scan is in progress.');
      this.postMessage({ type: 'workspaceSessionsPreloadCompleted', value: { cancelled: true } });
      return;
    }

    if (this.workspacePreload) {
      this.logger.info('Sequential workspace session preload is already in progress.');
      return;
    }

    const generation = this.scanGeneration;
    const workspaces = this.lastScan?.workspaces.slice() ?? [];
    const preload = this.preloadWorkspaceSessions(workspaces, generation);
    this.workspacePreload = preload;

    void preload.finally(() => {
      if (this.workspacePreload === preload) {
        this.workspacePreload = undefined;
      }
    });
  }

  private async preloadWorkspaceSessions(workspaces: WorkspaceSummary[], generation: number): Promise<void> {
    this.postMessage({
      type: 'workspaceSessionsPreloadStarted',
      value: { total: workspaces.length }
    });

    let completed = 0;
    for (const workspace of workspaces) {
      if (generation !== this.scanGeneration) {
        return;
      }

      await this.loadWorkspaceSessions(workspace.chatSessionsDir);
      if (generation !== this.scanGeneration) {
        return;
      }

      completed += 1;
      this.postMessage({
        type: 'workspaceSessionsPreloadProgress',
        value: { completed, total: workspaces.length }
      });
    }

    this.postMessage({
      type: 'workspaceSessionsPreloadCompleted',
      value: { cancelled: false, total: workspaces.length }
    });
  }

  private findWorkspaceSummary(chatSessionsDir: string): WorkspaceSummary | undefined {
    return this.lastScan?.workspaces.find((workspace) => workspace.chatSessionsDir === chatSessionsDir);
  }

  private isSessionSummary(value: unknown): value is SessionSummary {
    return this.isObject(value)
      && typeof value.id === 'string'
      && typeof value.title === 'string'
      && typeof value.isEmpty === 'boolean'
      && typeof value.workspaceHash === 'string'
      && typeof value.workspaceName === 'string'
      && typeof value.sourcePath === 'string'
      && typeof value.updatedAt === 'number';
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }

  private errorMessage(error: unknown, prefix: string): string {
    const suffix = error instanceof Error ? error.message : String(error);
    return `${prefix} ${suffix}`;
  }

  private logClientMessage(value: unknown): void {
    if (!this.isObject(value) || typeof value.message !== 'string') {
      return;
    }

    const level = value.level === 'info' || value.level === 'warn' || value.level === 'error'
      ? value.level
      : 'error';
    const source = typeof value.source === 'string' ? value.source : 'webview';
    const details = typeof value.details === 'string' ? value.details : undefined;
    const message = `[webview:${source}] ${value.message}`;

    if (level === 'info') {
      this.logger.info(details ? `${message} ${details}` : message);
      return;
    }

    if (level === 'warn') {
      this.logger.warn(details ? `${message} ${details}` : message);
      return;
    }

    if (details) {
      this.logger.error(message, details);
      return;
    }

    this.logger.error(message);
  }

  private logWarnings(scope: string, warnings: ReadonlyArray<{ location: string; message: string }>): void {
    for (const warning of warnings) {
      this.logger.warn(`${scope} warning: ${warning.message} (${warning.location})`);
    }
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
