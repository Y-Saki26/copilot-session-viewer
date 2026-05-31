import * as vscode from 'vscode';

export class OutputLogger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  public constructor(channelName: string) {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  public info(message: string): void {
    this.write('info', message);
  }

  public warn(message: string): void {
    this.write('warn', message);
  }

  public error(message: string, error?: unknown): void {
    if (error === undefined) {
      this.write('error', message);
      return;
    }

    this.write('error', `${message} ${this.stringifyError(error)}`);
  }

  public show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private write(level: 'info' | 'warn' | 'error', message: string): void {
    this.channel.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }

    return String(error);
  }
}