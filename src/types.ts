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
  responderUsername?: string;
  inputState?: SerializableChatInputState;
  requests?: SerializableChatRequestData[];
  pendingRequests?: unknown[];
  [key: string]: unknown;
}

export interface ChatLogDecodeResult<T> {
  data: T;
  lineCount: number;
}

export interface ViewerMarkdownResponsePart {
  type: 'markdown';
  text: string;
  rawText?: string;
}

export interface ViewerThinkingResponsePart {
  type: 'thinking';
  text: string;
  title?: string;
  done: boolean;
  rawText?: string;
}

export interface ViewerToolResponsePart {
  type: 'tool';
  title: string;
  toolId?: string;
  status: 'completed' | 'running' | 'denied';
  rawText?: string;
}

export interface ViewerEditResponsePart {
  type: 'edit';
  summary: string;
  uri?: string;
  rawText?: string;
}

export interface ViewerUnknownResponsePart {
  type: 'unknown';
  label: string;
  rawText: string;
}

export type ViewerResponsePart =
  | ViewerMarkdownResponsePart
  | ViewerThinkingResponsePart
  | ViewerToolResponsePart
  | ViewerEditResponsePart
  | ViewerUnknownResponsePart;

export interface ChatTurn {
  requestId: string;
  timestamp?: number;
  userText: string;
  responseParts: ViewerResponsePart[];
}

export interface ChatSessionDocument {
  id: string;
  title: string;
  workspaceHash: string;
  workspaceName: string;
  workspaceFolder?: string;
  sourcePath: string;
  createdAt?: number;
  updatedAt: number;
  responderUsername?: string;
  turns: ChatTurn[];
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