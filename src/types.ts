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

export interface WorkspaceSummary {
  workspaceHash: string;
  workspaceName: string;
  workspaceFolder?: string;
  chatSessionsDir: string;
  sessionCount: number;
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

export interface SerializableChatVariableData {
  variables?: unknown[];
  [key: string]: unknown;
}

export interface SerializableChatModeInfo {
  id?: string;
  modeId?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface SerializableChatAgentData {
  id?: string;
  [key: string]: unknown;
}

export interface SerializableChatResultData {
  errorDetails?: unknown;
  details?: unknown;
  [key: string]: unknown;
}

export interface SerializableChatRequestData {
  requestId?: string;
  timestamp?: number;
  message?: SerializableChatMessage;
  variableData?: SerializableChatVariableData;
  response?: unknown[];
  contentReferences?: unknown[];
  codeCitations?: unknown[];
  result?: SerializableChatResultData;
  modelId?: string;
  modeInfo?: SerializableChatModeInfo;
  agent?: SerializableChatAgentData;
  elapsedMs?: number;
  completionTokens?: number;
  timeSpentWaiting?: number;
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

export interface ViewerUri {
  label: string;
  scheme?: string;
  path?: string;
  fsPath?: string;
  external?: string;
}

export interface ViewerAttachment {
  kind: string;
  label: string;
  detail?: string;
}

export interface ViewerReferenceItem {
  label: string;
  detail?: string;
  uri?: ViewerUri;
}

export interface ViewerMarkdownCodeBlock {
  label: string;
  isEdit: boolean;
  subAgentInvocationId?: string;
}

export interface ViewerMarkdownResponsePart {
  type: 'markdown';
  id: string;
  text: string;
  subAgentInvocationId?: string;
  baseUri?: ViewerUri;
  uris?: Record<string, ViewerUri>;
  codeBlocks?: ViewerMarkdownCodeBlock[];
  rawText?: string;
}

export interface ViewerThinkingResponsePart {
  type: 'thinking';
  id: string;
  text: string;
  title: string;
  generatedTitle?: string;
  done: boolean;
  children: ViewerResponsePart[];
  rawText?: string;
}

export interface ViewerToolTodoItem {
  id: string;
  title: string;
  status: string;
}

export interface ViewerToolTerminalDetail {
  kind: 'terminal';
  command?: string;
  cwd?: string;
  exitCode?: number;
  output?: string;
  durationMs?: number;
  language?: string;
  isBackground?: boolean;
}

export interface ViewerToolTodoListDetail {
  kind: 'todoList';
  items: ViewerToolTodoItem[];
}

export interface ViewerToolSubagentDetail {
  kind: 'subagent';
  agentName?: string;
  description?: string;
  prompt?: string;
  result?: string;
  modelName?: string;
}

export interface ViewerToolInputDetail {
  kind: 'input';
  rawInput?: string;
  mcpAppData?: string;
}

export interface ViewerToolIoDetail {
  kind: 'io';
  input?: string;
  inputLanguage?: string;
  output?: string;
  isError?: boolean;
}

export interface ViewerToolUriListDetail {
  kind: 'uris';
  items: string[];
}

export interface ViewerToolTextDetail {
  kind: 'text';
  text: string;
}

export interface ViewerToolUnknownDetail {
  kind: 'unknown';
  text: string;
}

export type ViewerToolDetail =
  | ViewerToolTerminalDetail
  | ViewerToolTodoListDetail
  | ViewerToolSubagentDetail
  | ViewerToolInputDetail
  | ViewerToolIoDetail
  | ViewerToolUriListDetail
  | ViewerToolTextDetail
  | ViewerToolUnknownDetail;

export interface ViewerToolResponsePart {
  type: 'tool';
  id: string;
  title: string;
  toolId?: string;
  toolCallId?: string;
  subAgentInvocationId?: string;
  status: 'completed' | 'running' | 'denied';
  detail?: ViewerToolDetail;
  rawText?: string;
}

export interface ViewerSubagentResponsePart {
  type: 'subagent';
  id: string;
  subAgentInvocationId: string;
  title: string;
  agentName?: string;
  description?: string;
  prompt?: string;
  result?: string;
  modelName?: string;
  children: ViewerResponsePart[];
  rawText?: string;
}

export interface ViewerTextEditChange {
  rangeLabel: string;
  text: string;
}

export interface ViewerEditResponsePart {
  type: 'edit';
  id: string;
  summary: string;
  uri?: string;
  status: 'completed' | 'pending';
  editCount?: number;
  edits?: ViewerTextEditChange[];
  rawText?: string;
}

export interface ViewerProgressTaskResponsePart {
  type: 'progressTask';
  id: string;
  title: string;
  entries: string[];
  rawText?: string;
}

export interface ViewerConfirmationResponsePart {
  type: 'confirmation';
  id: string;
  title: string;
  message?: string;
  buttons: string[];
  isUsed: boolean;
  rawText?: string;
}

export interface ViewerElicitationResponsePart {
  type: 'elicitation';
  id: string;
  title: string;
  message?: string;
  state?: string;
  acceptedResult?: string;
  rawText?: string;
}

export interface ViewerQuestionCarouselQuestion {
  id?: string;
  type: string;
  title: string;
  message?: string;
  options: string[];
  answer?: string | string[];
}

export interface ViewerQuestionCarouselResponsePart {
  type: 'questionCarousel';
  id: string;
  questions: ViewerQuestionCarouselQuestion[];
  allowSkip: boolean;
  isUsed: boolean;
  rawText?: string;
}

export interface ViewerReferencesResponsePart {
  type: 'references';
  id: string;
  title: string;
  items: ViewerReferenceItem[];
  rawText?: string;
}

export interface ViewerCodeCitationsResponsePart {
  type: 'codeCitations';
  id: string;
  items: ViewerReferenceItem[];
  rawText?: string;
}

export interface ViewerErrorResponsePart {
  type: 'error';
  id: string;
  title: string;
  message: string;
  buttons?: string[];
  rawText?: string;
}

export interface ViewerFooterResponsePart {
  type: 'footer';
  id: string;
  text: string;
  rawText?: string;
}

export interface ViewerNoticeResponsePart {
  type: 'notice';
  id: string;
  tone: 'info' | 'warning';
  title?: string;
  text: string;
  rawText?: string;
}

export interface ViewerUnknownResponsePart {
  type: 'unknown';
  id: string;
  label: string;
  rawText: string;
}

export type ViewerResponsePart =
  | ViewerMarkdownResponsePart
  | ViewerThinkingResponsePart
  | ViewerSubagentResponsePart
  | ViewerToolResponsePart
  | ViewerEditResponsePart
  | ViewerProgressTaskResponsePart
  | ViewerConfirmationResponsePart
  | ViewerElicitationResponsePart
  | ViewerQuestionCarouselResponsePart
  | ViewerReferencesResponsePart
  | ViewerCodeCitationsResponsePart
  | ViewerErrorResponsePart
  | ViewerFooterResponsePart
  | ViewerNoticeResponsePart
  | ViewerUnknownResponsePart;

export interface ChatTurn {
  requestId: string;
  timestamp?: number;
  userText: string;
  attachments: ViewerAttachment[];
  responseParts: ViewerResponsePart[];
  modelId?: string;
  modeId?: string;
  modeKind?: string;
  agentId?: string;
  elapsedMs?: number;
  completionTokens?: number;
  timeSpentWaiting?: number;
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
  version?: number;
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
  workspaces: WorkspaceSummary[];
  warnings: ScanWarning[];
  scannedAt: number;
  loadedFromCache?: boolean;
}
