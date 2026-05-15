export interface SessionSummary {
  id: string;
  title: string;
  workspaceHash: string;
  workspaceName: string;
  workspaceFolder?: string;
  sourcePath: string;
  createdAt?: number;
  updatedAt: number;
}

export interface ScanWarning {
  location: string;
  message: string;
}

export interface ScanSummary {
  rootsScanned: string[];
  workspaceCount: number;
  sessionCount: number;
  sessions: SessionSummary[];
  warnings: ScanWarning[];
  scannedAt: number;
}