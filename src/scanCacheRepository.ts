import * as fs from 'fs/promises';
import * as path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import * as vscode from 'vscode';

import { ScanSummary, ScanWarning, SessionSummary } from './types';

let sqlJsInstance: Promise<SqlJsStatic> | undefined;

export class ScanCacheRepository {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async load(): Promise<ScanSummary | undefined> {
    const database = await this.openDatabase();

    try {
      const scannedAt = this.readMetadataNumber(database, 'scannedAt');
      if (!scannedAt) {
        return undefined;
      }

      const rootsScanned = this.readRoots(database);
      const sessions = this.readSessions(database);
      const warnings = this.readWarnings(database);
      const workspaceCount = new Set(sessions.map((session) => session.workspaceHash)).size;

      return {
        rootsScanned,
        workspaceCount,
        sessionCount: sessions.length,
        sessions,
        warnings,
        scannedAt,
        loadedFromCache: true
      };
    } finally {
      database.close();
    }
  }

  public async save(summary: ScanSummary): Promise<void> {
    const database = await this.openDatabase();

    try {
      database.exec('BEGIN');
      database.exec('DELETE FROM metadata');
      database.exec('DELETE FROM roots');
      database.exec('DELETE FROM warnings');
      database.exec('DELETE FROM sessions');

      const metadataStatement = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
      metadataStatement.run(['scannedAt', String(summary.scannedAt)]);
      metadataStatement.free();

      const rootStatement = database.prepare('INSERT INTO roots (root_path) VALUES (?)');
      for (const root of summary.rootsScanned) {
        rootStatement.run([root]);
      }
      rootStatement.free();

      const warningStatement = database.prepare('INSERT INTO warnings (location, message) VALUES (?, ?)');
      for (const warning of summary.warnings) {
        warningStatement.run([warning.location, warning.message]);
      }
      warningStatement.free();

      const sessionStatement = database.prepare(`
        INSERT INTO sessions (
          session_id,
          workspace_hash,
          title,
          workspace_name,
          workspace_folder,
          source_path,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const session of summary.sessions) {
        sessionStatement.run([
          session.id,
          session.workspaceHash,
          session.title,
          session.workspaceName,
          session.workspaceFolder ?? null,
          session.sourcePath,
          session.createdAt ?? null,
          session.updatedAt
        ]);
      }
      sessionStatement.free();

      database.exec('COMMIT');
      await this.persist(database);
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after an unsuccessful write.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  private async openDatabase(): Promise<Database> {
    const SQL = await this.getSqlJs();
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });

    try {
      const fileContents = await fs.readFile(this.databasePath);
      const database = new SQL.Database(fileContents);
      this.ensureSchema(database);
      return database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      const database = new SQL.Database();
      this.ensureSchema(database);
      return database;
    }
  }

  private ensureSchema(database: Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roots (
        root_path TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location TEXT NOT NULL,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT NOT NULL,
        workspace_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        workspace_name TEXT NOT NULL,
        workspace_folder TEXT,
        source_path TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_hash, source_path)
      );
    `);
  }

  private async persist(database: Database): Promise<void> {
    const exported = database.export();
    await fs.writeFile(this.databasePath, Buffer.from(exported));
  }

  private readMetadataNumber(database: Database, key: string): number | undefined {
    const statement = database.prepare('SELECT value FROM metadata WHERE key = ? LIMIT 1');

    try {
      statement.bind([key]);
      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as { value?: string };
      const parsed = Number(row.value);
      return Number.isFinite(parsed) ? parsed : undefined;
    } finally {
      statement.free();
    }
  }

  private readRoots(database: Database): string[] {
    const statement = database.prepare('SELECT root_path FROM roots ORDER BY root_path ASC');
    const roots: string[] = [];

    try {
      while (statement.step()) {
        const row = statement.getAsObject() as { root_path?: string };
        if (typeof row.root_path === 'string') {
          roots.push(row.root_path);
        }
      }
    } finally {
      statement.free();
    }

    return roots;
  }

  private readWarnings(database: Database): ScanWarning[] {
    const statement = database.prepare('SELECT location, message FROM warnings ORDER BY id ASC');
    const warnings: ScanWarning[] = [];

    try {
      while (statement.step()) {
        const row = statement.getAsObject() as { location?: string; message?: string };
        if (typeof row.location === 'string' && typeof row.message === 'string') {
          warnings.push({
            location: row.location,
            message: row.message
          });
        }
      }
    } finally {
      statement.free();
    }

    return warnings;
  }

  private readSessions(database: Database): SessionSummary[] {
    const statement = database.prepare(`
      SELECT
        session_id,
        workspace_hash,
        title,
        workspace_name,
        workspace_folder,
        source_path,
        created_at,
        updated_at
      FROM sessions
      ORDER BY updated_at DESC, title ASC
    `);
    const sessions: SessionSummary[] = [];

    try {
      while (statement.step()) {
        const row = statement.getAsObject() as {
          session_id?: string;
          workspace_hash?: string;
          title?: string;
          workspace_name?: string;
          workspace_folder?: string | null;
          source_path?: string;
          created_at?: number | null;
          updated_at?: number;
        };

        if (
          typeof row.session_id === 'string' &&
          typeof row.workspace_hash === 'string' &&
          typeof row.title === 'string' &&
          typeof row.workspace_name === 'string' &&
          typeof row.source_path === 'string' &&
          typeof row.updated_at === 'number'
        ) {
          sessions.push({
            id: row.session_id,
            workspaceHash: row.workspace_hash,
            title: row.title,
            workspaceName: row.workspace_name,
            workspaceFolder: typeof row.workspace_folder === 'string' ? row.workspace_folder : undefined,
            sourcePath: row.source_path,
            createdAt: typeof row.created_at === 'number' ? row.created_at : undefined,
            updatedAt: row.updated_at
          });
        }
      }
    } finally {
      statement.free();
    }

    return sessions;
  }

  private async getSqlJs(): Promise<SqlJsStatic> {
    if (!sqlJsInstance) {
      const sqlJsDistPath = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));
      sqlJsInstance = initSqlJs({
        locateFile: (file: string) => path.join(sqlJsDistPath, file)
      });
    }

    return sqlJsInstance;
  }

  private get databasePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'session-cache.sqlite');
  }
}