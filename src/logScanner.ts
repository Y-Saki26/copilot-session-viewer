import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatLogDecoder, decodeChatLogFile } from './chatLogDecoder';
import { ScanSummary, ScanWarning, SessionSummary, WorkspaceSummary } from './types';
import { getWorkspaceStorageRoots } from './workspaceStorageRoots';

type WorkspaceDescriptor = {
  workspaceHash: string;
  workspaceName: string;
  workspaceFolder?: string;
  chatSessionsDir: string;
};

type ParsedSession = {
  id: string;
  title?: string;
  inputText?: string;
  createdAt?: number;
};

export class CopilotSessionScanner {
  private readonly chatLogDecoder = new ChatLogDecoder();

  public async scan(): Promise<ScanSummary> {
    const warnings: ScanWarning[] = [];
    const roots = await this.resolveRoots(warnings);
    const workspaceDescriptors: WorkspaceDescriptor[] = [];

    for (const root of roots) {
      const descriptors = await this.findWorkspaceDescriptors(root, warnings);
      workspaceDescriptors.push(...descriptors);
    }

    const workspaces: WorkspaceSummary[] = [];
    let sessionCount = 0;

    for (const workspace of workspaceDescriptors) {
      const sessionFiles = await this.listSessionFiles(workspace.chatSessionsDir, warnings);
      sessionCount += sessionFiles.length;
      workspaces.push({
        workspaceHash: workspace.workspaceHash,
        workspaceName: workspace.workspaceName,
        workspaceFolder: workspace.workspaceFolder,
        chatSessionsDir: workspace.chatSessionsDir,
        sessionCount: sessionFiles.length
      });
    }

    workspaces.sort((left, right) => left.workspaceName.localeCompare(right.workspaceName) || left.chatSessionsDir.localeCompare(right.chatSessionsDir));

    return {
      rootsScanned: roots,
      workspaceCount: workspaces.length,
      sessionCount,
      workspaces,
      warnings,
      scannedAt: Date.now()
    };
  }

  public async readSessionData(sessionFile: string) {
    return decodeChatLogFile(sessionFile, this.chatLogDecoder);
  }

  public async readWorkspaceSessions(workspace: WorkspaceSummary): Promise<{ sessions: SessionSummary[]; warnings: ScanWarning[] }> {
    const warnings: ScanWarning[] = [];
    const sessionFiles = await this.listSessionFiles(workspace.chatSessionsDir, warnings);
    const sessions: SessionSummary[] = [];

    for (const sessionFile of sessionFiles) {
      const session = await this.parseSessionFile(sessionFile, {
        workspaceHash: workspace.workspaceHash,
        workspaceName: workspace.workspaceName,
        workspaceFolder: workspace.workspaceFolder,
        chatSessionsDir: workspace.chatSessionsDir
      }, warnings);

      if (session) {
        sessions.push(session);
      }
    }

    sessions.sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title));

    return {
      sessions,
      warnings
    };
  }

  private async resolveRoots(warnings: ScanWarning[]): Promise<string[]> {
    const configuration = vscode.workspace.getConfiguration('copilotSessionViewer');
    const configuredRoots = configuration.get<string[]>('workspaceStorageRoots', []);
    const uniqueRoots = new Set<string>();

    for (const configuredRoot of getWorkspaceStorageRoots(configuredRoots)) {
      if (!configuredRoot.trim()) {
        continue;
      }

      const expanded = this.expandPathVariables(configuredRoot.trim());
      uniqueRoots.add(path.resolve(expanded));
    }

    const existingRoots: string[] = [];
    for (const root of uniqueRoots) {
      if (await this.pathExists(root)) {
        existingRoots.push(root);
      } else {
        warnings.push({
          location: root,
          message: 'Configured workspaceStorage root was not found.'
        });
      }
    }

    return existingRoots;
  }

  private async findWorkspaceDescriptors(root: string, warnings: ScanWarning[]): Promise<WorkspaceDescriptor[]> {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      warnings.push({
        location: root,
        message: this.errorMessage(error, 'Failed to read workspaceStorage root.')
      });
      return [];
    }

    const descriptors: WorkspaceDescriptor[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspaceDir = path.join(root, entry.name);
      const chatSessionsDir = path.join(workspaceDir, 'chatSessions');
      if (!(await this.pathExists(chatSessionsDir))) {
        continue;
      }

      const workspaceMetadata = await this.readWorkspaceMetadata(workspaceDir, entry.name, warnings);
      descriptors.push({
        workspaceHash: entry.name,
        workspaceName: workspaceMetadata.workspaceName,
        workspaceFolder: workspaceMetadata.workspaceFolder,
        chatSessionsDir
      });
    }

    return descriptors;
  }

  private async readWorkspaceMetadata(
    workspaceDir: string,
    workspaceHash: string,
    warnings: ScanWarning[]
  ): Promise<{ workspaceName: string; workspaceFolder?: string }> {
    const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');
    if (!(await this.pathExists(workspaceJsonPath))) {
      return { workspaceName: workspaceHash };
    }

    try {
      const contents = await fs.readFile(workspaceJsonPath, 'utf8');
      const parsed = JSON.parse(contents) as { folder?: string; workspace?: string };
      const rawPath = parsed.folder ?? parsed.workspace;
      if (!rawPath) {
        return { workspaceName: workspaceHash };
      }

      return {
        workspaceName: this.extractWorkspaceName(rawPath) ?? workspaceHash,
        workspaceFolder: this.normalizeWorkspaceLocation(rawPath)
      };
    } catch (error) {
      warnings.push({
        location: workspaceJsonPath,
        message: this.errorMessage(error, 'Failed to parse workspace.json.')
      });
      return { workspaceName: workspaceHash };
    }
  }

  private async listSessionFiles(chatSessionsDir: string, warnings: ScanWarning[]): Promise<string[]> {
    try {
      const entries = await fs.readdir(chatSessionsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')))
        .map((entry) => path.join(chatSessionsDir, entry.name));
    } catch (error) {
      warnings.push({
        location: chatSessionsDir,
        message: this.errorMessage(error, 'Failed to read chatSessions directory.')
      });
      return [];
    }
  }

  private async parseSessionFile(
    sessionFile: string,
    workspace: WorkspaceDescriptor,
    warnings: ScanWarning[]
  ): Promise<SessionSummary | undefined> {
    try {
      const contents = await fs.readFile(sessionFile, 'utf8');
      const stats = await fs.stat(sessionFile);
      const parsed = sessionFile.endsWith('.jsonl')
        ? this.parseJsonLines(contents, sessionFile, warnings)
        : this.parseJsonSnapshot(contents, sessionFile, warnings);

      if (!parsed) {
        return undefined;
      }

      const title = parsed.title ?? this.buildFallbackTitle(parsed.inputText) ?? path.basename(sessionFile, path.extname(sessionFile));

      return {
        id: parsed.id,
        title,
        workspaceHash: workspace.workspaceHash,
        workspaceName: workspace.workspaceName,
        workspaceFolder: workspace.workspaceFolder,
        sourcePath: sessionFile,
        createdAt: parsed.createdAt,
        updatedAt: stats.mtimeMs
      };
    } catch (error) {
      warnings.push({
        location: sessionFile,
        message: this.errorMessage(error, 'Failed to parse session file.')
      });
      return undefined;
    }
  }

  private parseJsonSnapshot(contents: string, sessionFile: string, warnings: ScanWarning[]): ParsedSession | undefined {
    try {
      const parsed = JSON.parse(contents) as { sessionId?: string; customTitle?: string; creationDate?: number; inputState?: { inputText?: string } };
      return {
        id: parsed.sessionId ?? path.basename(sessionFile, path.extname(sessionFile)),
        title: parsed.customTitle,
        inputText: parsed.inputState?.inputText,
        createdAt: parsed.creationDate
      };
    } catch (error) {
      warnings.push({
        location: sessionFile,
        message: this.errorMessage(error, 'Failed to parse JSON session file.')
      });
      return undefined;
    }
  }

  private parseJsonLines(contents: string, sessionFile: string, warnings: ScanWarning[]): ParsedSession | undefined {
    const fallbackId = path.basename(sessionFile, path.extname(sessionFile));
    let sessionId = fallbackId;
    let title: string | undefined;
    let inputText: string | undefined;
    let createdAt: number | undefined;

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const record = JSON.parse(trimmed) as {
          kind?: number;
          k?: unknown;
          v?: unknown;
        };

        if (record.kind === 0 && this.isObject(record.v)) {
          sessionId = this.readString(record.v.sessionId) ?? sessionId;
          title = this.readString(record.v.customTitle) ?? title;
          createdAt = this.readNumber(record.v.creationDate) ?? createdAt;

          const initialInput = this.readString(record.v.inputState?.inputText);
          if (!inputText && initialInput) {
            inputText = initialInput;
          }
        }

        if (record.kind === 1 && Array.isArray(record.k)) {
          if (record.k.length === 1 && record.k[0] === 'customTitle') {
            title = this.readString(record.v) ?? title;
          }

          if (
            record.k.length === 2 &&
            record.k[0] === 'inputState' &&
            record.k[1] === 'inputText' &&
            !inputText
          ) {
            inputText = this.readString(record.v) ?? inputText;
          }
        }
      } catch (error) {
        warnings.push({
          location: sessionFile,
          message: this.errorMessage(error, 'Failed to parse one JSONL record.')
        });
      }
    }

    return {
      id: sessionId,
      title,
      inputText,
      createdAt
    };
  }

  private buildFallbackTitle(inputText?: string): string | undefined {
    if (!inputText) {
      return undefined;
    }

    const firstLine = inputText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!firstLine) {
      return undefined;
    }

    if (firstLine.length <= 50) {
      return firstLine;
    }

    return `${firstLine.slice(0, 47)}...`;
  }

  private extractWorkspaceName(rawLocation: string): string | undefined {
    const normalized = this.normalizeWorkspaceLocation(rawLocation);
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1);
  }

  private normalizeWorkspaceLocation(rawLocation: string): string {
    const withoutScheme = rawLocation.replace(/^file:\/\//, '');
    return decodeURIComponent(withoutScheme);
  }

  private expandPathVariables(inputPath: string): string {
    let expanded = inputPath;

    if (expanded.startsWith('~')) {
      const homeDirectory = process.env.HOME ?? process.env.USERPROFILE;
      if (homeDirectory) {
        expanded = path.join(homeDirectory, expanded.slice(1));
      }
    }

    expanded = expanded.replace(/%([^%]+)%/g, (match, variableName: string) => {
      return process.env[variableName] ?? match;
    });

    expanded = expanded.replace(/\$\{env:([^}]+)\}/g, (match, variableName: string) => {
      return process.env[variableName] ?? match;
    });

    expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variableName: string) => {
      return process.env[variableName] ?? match;
    });

    return expanded;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private errorMessage(error: unknown, prefix: string): string {
    const suffix = error instanceof Error ? error.message : String(error);
    return `${prefix} ${suffix}`;
  }
}