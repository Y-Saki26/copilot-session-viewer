import * as vscode from 'vscode';

import { OutputLogger } from './outputLogger';
import { SessionsViewProvider } from './viewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new OutputLogger('Copilot Session Viewer');
  const provider = new SessionsViewProvider(context, logger);

  context.subscriptions.push(logger);
  logger.info('Extension activated.');

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SessionsViewProvider.viewId, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotSessionViewer.refreshSessions', async () => {
      logger.info('Refresh command invoked.');
      await provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotSessionViewer.openSettings', async () => {
      logger.info('Open settings command invoked.');
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'copilotSessionViewer.vscodeUserStorageRoots'
      );
    })
  );
}

export function deactivate(): void {}
