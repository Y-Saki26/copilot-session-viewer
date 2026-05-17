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

export interface SerializableChatInputState {
  inputText?: string;
  [key: string]: unknown;
}

export interface SerializableChatMessage {
  text?: string;
  parts?: unknown[];
  [key: string]: unknown;
}

export interface SerializableChatRequestData {
  requestId?: string;
  timestamp?: number;
  message?: SerializableChatMessage;
  response?: unknown[];
  [key: string]: unknown;
}

export interface SerializableChatData {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  customTitle?: string;
  inputState?: SerializableChatInputState;
  requests?: SerializableChatRequestData[];
  pendingRequests?: unknown[];
  [key: string]: unknown;
}

export interface ChatLogDecodeResult<T> {
  data: T;
  lineCount: number;
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
  loadedFromCache?: boolean;
}