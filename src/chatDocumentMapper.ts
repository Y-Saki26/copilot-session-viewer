import {
  ChatSessionDocument,
  ChatTurn,
  SerializableChatData,
  SerializableChatRequestData,
  SessionSummary,
  ViewerEditResponsePart,
  ViewerMarkdownResponsePart,
  ViewerResponsePart,
  ViewerThinkingResponsePart,
  ViewerToolResponsePart,
  ViewerUnknownResponsePart
} from './types';

export function mapChatSessionDocument(summary: SessionSummary, data: SerializableChatData): ChatSessionDocument {
  const requests = Array.isArray(data.requests) ? data.requests : [];

  return {
    id: readString(data.sessionId) ?? summary.id,
    title: readString(data.customTitle) ?? summary.title,
    workspaceHash: summary.workspaceHash,
    workspaceName: summary.workspaceName,
    workspaceFolder: summary.workspaceFolder,
    sourcePath: summary.sourcePath,
    createdAt: readNumber(data.creationDate) ?? summary.createdAt,
    updatedAt: summary.updatedAt,
    responderUsername: readString(data.responderUsername),
    turns: requests.map((request, index) => mapTurn(request, index))
  };
}

function mapTurn(request: SerializableChatRequestData, index: number): ChatTurn {
  return {
    requestId: readString(request.requestId) ?? `request-${index + 1}`,
    timestamp: readNumber(request.timestamp),
    userText: extractUserText(request.message) ?? 'No user message text captured.',
    responseParts: mapResponseParts(request.response)
  };
}

function mapResponseParts(parts: unknown[] | undefined): ViewerResponsePart[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const mappedParts: ViewerResponsePart[] = [];

  for (const part of parts) {
    const mappedPart = mapResponsePart(part);
    if (mappedPart) {
      mappedParts.push(mappedPart);
    }
  }

  return mappedParts;
}

function mapResponsePart(part: unknown): ViewerResponsePart | undefined {
  if (typeof part === 'string') {
    return createMarkdownPart(part, part);
  }

  if (!isPlainObject(part)) {
    return createUnknownPart('Unknown response part', part);
  }

  const kind = readString(part.kind);

  if (!kind) {
    const markdownText = readString(part.value);
    if (markdownText) {
      return createMarkdownPart(markdownText, part);
    }

    return createUnknownPart('Unknown response part', part);
  }

  switch (kind) {
    case 'thinking':
      return createThinkingPart(part);
    case 'toolInvocationSerialized':
      return createToolPart(part);
    case 'textEditGroup':
      return createEditPart(part);
    default:
      return createUnknownPart(kind, part);
  }
}

function createMarkdownPart(text: string, raw: unknown): ViewerMarkdownResponsePart {
  return {
    type: 'markdown',
    text,
    rawText: stringifyRaw(raw)
  };
}

function createThinkingPart(part: Record<string, unknown>): ViewerThinkingResponsePart | undefined {
  const text = extractTextValue(part.value);
  const done = hasReasoningCompleted(part) || !text;

  if (!text) {
    return undefined;
  }

  return {
    type: 'thinking',
    text,
    title: readString(part.generatedTitle) ?? 'Thinking',
    done,
    rawText: stringifyRaw(part)
  };
}

function createToolPart(part: Record<string, unknown>): ViewerToolResponsePart {
  return {
    type: 'tool',
    title: extractToolTitle(part),
    toolId: readString(part.toolId),
    status: extractToolStatus(part),
    rawText: stringifyRaw(part)
  };
}

function createEditPart(part: Record<string, unknown>): ViewerEditResponsePart {
  const uri = extractUriLabel(part.uri);
  const editCount = Array.isArray(part.edits) ? part.edits.length : undefined;
  const statusSuffix = typeof part.done === 'boolean' ? (part.done ? ' completed' : ' pending') : '';
  const countLabel = typeof editCount === 'number' ? `${editCount} edit${editCount === 1 ? '' : 's'}` : 'edits';

  return {
    type: 'edit',
    summary: uri ? `${uri} (${countLabel})${statusSuffix}` : `${countLabel}${statusSuffix}`,
    uri,
    rawText: stringifyRaw(part)
  };
}

function createUnknownPart(label: string, raw: unknown): ViewerUnknownResponsePart {
  return {
    type: 'unknown',
    label,
    rawText: stringifyRaw(raw)
  };
}

function extractUserText(message: unknown): string | undefined {
  if (!isPlainObject(message)) {
    return undefined;
  }

  const directText = readString(message.text);
  if (directText) {
    return directText;
  }

  if (!Array.isArray(message.parts)) {
    return undefined;
  }

  const textParts = message.parts
    .map(extractTextValue)
    .filter((value): value is string => Boolean(value));

  return textParts.length > 0 ? textParts.join('\n\n') : undefined;
}

function extractTextValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const textSegments = value
      .map(extractTextValue)
      .filter((segment): segment is string => Boolean(segment));

    return textSegments.length > 0 ? textSegments.join('\n') : undefined;
  }

  if (isPlainObject(value)) {
    const nestedText = readString(value.value);
    if (nestedText) {
      return nestedText;
    }
  }

  return undefined;
}

function extractToolTitle(part: Record<string, unknown>): string {
  return (
    readString(part.generatedTitle) ??
    extractMessageText(part.pastTenseMessage) ??
    extractMessageText(part.invocationMessage) ??
    readString(part.toolId) ??
    'Tool invocation'
  );
}

function extractToolStatus(part: Record<string, unknown>): ViewerToolResponsePart['status'] {
  const confirmation = isPlainObject(part.isConfirmed) ? part.isConfirmed : undefined;

  if (confirmation && confirmation.type === 0) {
    return 'denied';
  }

  return part.isComplete === true ? 'completed' : 'running';
}

function extractMessageText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (isPlainObject(value)) {
    return readString(value.value);
  }

  return undefined;
}

function hasReasoningCompleted(part: Record<string, unknown>): boolean {
  if (!isPlainObject(part.metadata)) {
    return false;
  }

  return part.metadata.vscodeReasoningDone === true;
}

function extractUriLabel(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const fsPath = readString(value.fsPath);
  if (fsPath) {
    return fsPath;
  }

  const pathValue = readString(value.path);
  const scheme = readString(value.scheme);
  if (pathValue && scheme) {
    return `${scheme}:${pathValue}`;
  }

  if (pathValue) {
    return pathValue;
  }

  return readString(value.external) ?? readString(value.value);
}

function stringifyRaw(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}