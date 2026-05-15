import * as vscode from 'vscode';

import { SessionsViewProvider } from './viewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SessionsViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SessionsViewProvider.viewId, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotSessionViewer.refreshSessions', async () => {
      await provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotSessionViewer.openSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'copilotSessionViewer.workspaceStorageRoots'
      );
    })
  );
}

export function deactivate(): void {}