import * as vscode from 'vscode';

import { OutputLogger } from './outputLogger';
import { ChatSessionDocument, SessionSummary } from './types';

type SessionPanelState =
  | { type: 'loading'; title: string; message: string }
  | { type: 'document'; value: ChatSessionDocument }
  | { type: 'error'; title: string; message: string };

export class SessionPanel {
  private panel?: vscode.WebviewPanel;
  private state: SessionPanelState = {
    type: 'loading',
    title: 'Copilot Session Viewer',
    message: 'Select a session to inspect the conversation.'
  };
  private ready = false;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: OutputLogger
  ) {}

  public showLoading(session: SessionSummary): void {
    this.state = {
      type: 'loading',
      title: session.title,
      message: 'Restoring session log...'
    };
    this.reveal(session.title);
    this.postState();
  }

  public showDocument(document: ChatSessionDocument): void {
    this.state = {
      type: 'document',
      value: document
    };
    this.reveal(document.title);
    this.postState();
  }

  public showError(title: string, message: string): void {
    this.state = {
      type: 'error',
      title,
      message
    };
    this.reveal(title);
    this.postState();
  }

  private reveal(title: string): void {
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }

    this.ready = false;
    this.panel = vscode.window.createWebviewPanel(
      'copilotSessionViewer.sessionPanel',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
        ]
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    });
  }

  private handleMessage(message: unknown): void {
    if (!isPlainObject(message)) {
      return;
    }

    if (message.type === 'ready') {
      this.ready = true;
      this.postState();
      return;
    }

    if (message.type === 'clientLog') {
      this.logClientMessage(message.value);
    }
  }

  private postState(): void {
    if (!this.panel || !this.ready) {
      return;
    }

    switch (this.state.type) {
      case 'loading':
        void this.panel.webview.postMessage({ type: 'sessionDocumentLoading', value: this.state });
        return;
      case 'document':
        void this.panel.webview.postMessage({ type: 'sessionDocument', value: this.state.value });
        return;
      case 'error':
        void this.panel.webview.postMessage({ type: 'sessionDocumentError', value: this.state });
        return;
    }
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
    <title>Session Detail</title>
  </head>
  <body data-view="session-detail">
    <div class="detail-app">
      <header class="hero detail-hero">
        <div>
          <p class="eyebrow">Session Detail</p>
          <h1>Conversation Viewer</h1>
          <p class="subtitle">Select a session from the sidebar to restore the saved conversation and inspect the response parts.</p>
        </div>
      </header>
      <section id="detailSummary" class="summary"></section>
      <section id="detailTurns" class="detail-turns"></section>
    </div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private logClientMessage(value: unknown): void {
    if (!isPlainObject(value) || typeof value.message !== 'string') {
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
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}