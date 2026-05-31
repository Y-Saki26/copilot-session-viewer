import * as vscode from 'vscode';

import { mapChatSessionDocument } from './chatDocumentMapper';
import { CopilotSessionScanner } from './logScanner';
import { ScanCacheRepository } from './scanCacheRepository';
import { SessionPanel } from './sessionPanel';
import { ScanSummary, SessionSummary } from './types';

export class SessionsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'copilotSessionViewer.sessionsView';

  private view?: vscode.WebviewView;
  private readonly scanner = new CopilotSessionScanner();
  private readonly cacheRepository: ScanCacheRepository;
  private readonly sessionPanel: SessionPanel;
  private lastScan?: ScanSummary;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.cacheRepository = new ScanCacheRepository(context);
    this.sessionPanel = new SessionPanel(context);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    void this.initialize();
  }

  public async refresh(): Promise<void> {
    try {
      const scan = await this.scanner.scan(this.context);
      await this.cacheRepository.save(scan);
      this.lastScan = scan;
      this.postMessage({ type: 'scanResult', value: scan });
    } catch (error) {
      void vscode.window.showErrorMessage(this.errorMessage(error, 'Copilot Session Viewer failed to scan logs.'));
      this.postMessage({
        type: 'scanError',
        value: this.errorMessage(error, 'Failed to scan session logs.')
      });
    }
  }

  private async initialize(): Promise<void> {
    try {
      const cachedScan = await this.cacheRepository.load();
      if (cachedScan) {
        this.lastScan = cachedScan;
        this.postMessage({ type: 'scanResult', value: cachedScan });
      }
    } catch (error) {
      console.warn(this.errorMessage(error, 'Failed to load scan cache.'));
    }

    await this.refresh();
  }

  private handleMessage(message: unknown): void {
    if (!this.isObject(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
        if (this.lastScan) {
          this.postMessage({ type: 'scanResult', value: this.lastScan });
        }
        return;
      case 'refresh':
        void this.refresh();
        return;
      case 'openSettings':
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'copilotSessionViewer.workspaceStorageRoots'
        );
        return;
      case 'selectSession':
        if (typeof message.sourcePath === 'string') {
          void this.openSession(message.sourcePath);
        }
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Copilot Session Viewer</title>
  </head>
  <body data-view="sessions">
    <div class="app">
      <header class="hero">
        <div>
          <p class="eyebrow">Mockup</p>
          <h1>Copilot Session Viewer</h1>
          <p class="subtitle">Scan workspaceStorage, choose a session from the list, and open the restored conversation in a main panel.</p>
        </div>
        <div class="actions">
          <button id="refreshButton">Refresh</button>
          <button id="settingsButton" class="secondary">Settings</button>
        </div>
      </header>
      <section id="summary" class="summary"></section>
      <section id="warnings" class="warnings"></section>
      <section id="sessions" class="sessions"></section>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private async openSession(sourcePath: string): Promise<void> {
    const summary = this.findSessionSummary(sourcePath);
    if (!summary) {
      const message = `Failed to find session metadata for ${sourcePath}.`;
      this.sessionPanel.showError('Session not found', message);
      void vscode.window.showErrorMessage(message);
      return;
    }

    this.sessionPanel.showLoading(summary);

    try {
      const data = await this.scanner.readSessionData(summary.sourcePath);
      const document = mapChatSessionDocument(summary, data);
      this.sessionPanel.showDocument(document);
    } catch (error) {
      const message = this.errorMessage(error, 'Failed to restore session log.');
      this.sessionPanel.showError(summary.title, message);
      void vscode.window.showErrorMessage(message);
    }
  }

  private findSessionSummary(sourcePath: string): SessionSummary | undefined {
    return this.lastScan?.sessions.find((session) => session.sourcePath === sourcePath);
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }

  private errorMessage(error: unknown, prefix: string): string {
    const suffix = error instanceof Error ? error.message : String(error);
    return `${prefix} ${suffix}`;
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