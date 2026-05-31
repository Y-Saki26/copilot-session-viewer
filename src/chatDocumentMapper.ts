import {
  ChatSessionDocument,
  ChatTurn,
  SerializableChatData,
  SerializableChatRequestData,
  SessionSummary,
  ViewerAttachment,
  ViewerCodeCitationsResponsePart,
  ViewerConfirmationResponsePart,
  ViewerEditResponsePart,
  ViewerElicitationResponsePart,
  ViewerErrorResponsePart,
  ViewerFooterResponsePart,
  ViewerMarkdownResponsePart,
  ViewerNoticeResponsePart,
  ViewerProgressTaskResponsePart,
  ViewerQuestionCarouselQuestion,
  ViewerQuestionCarouselResponsePart,
  ViewerReferenceItem,
  ViewerReferencesResponsePart,
  ViewerResponsePart,
  ViewerThinkingResponsePart,
  ViewerToolResponsePart,
  ViewerUri,
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
    version: readNumber(data.version),
    responderUsername: readString(data.responderUsername),
    turns: requests.map((request, index) => mapTurn(request, index))
  };
}

function mapTurn(request: SerializableChatRequestData, index: number): ChatTurn {
  const requestId = readString(request.requestId) ?? `request-${index + 1}`;

  return {
    requestId,
    timestamp: readNumber(request.timestamp),
    userText: extractUserText(request.message) ?? 'No user message text captured.',
    attachments: mapAttachments(request.variableData?.variables),
    responseParts: normalizeResponseParts(request, requestId),
    modelId: readString(request.modelId),
    modeId: readString(request.modeInfo?.id) ?? readString(request.modeInfo?.modeId),
    modeKind: readString(request.modeInfo?.kind),
    agentId: readString(request.agent?.id),
    elapsedMs: readNumber(request.elapsedMs),
    completionTokens: readNumber(request.completionTokens),
    timeSpentWaiting: readNumber(request.timeSpentWaiting)
  };
}

function normalizeResponseParts(request: SerializableChatRequestData, requestId: string): ViewerResponsePart[] {
  const response = Array.isArray(request.response) ? request.response : [];
  const normalized: ViewerResponsePart[] = [];
  const contentReferences = mapReferenceItems(request.contentReferences);

  if (contentReferences.length > 0) {
    normalized.push(createReferencesPart(`${requestId}:synthetic:references`, 'References', contentReferences, request.contentReferences));
  }

  let activeThinking: ViewerThinkingResponsePart | undefined;
  let currentMarkdown: ViewerMarkdownResponsePart | undefined;

  const flushMarkdown = (): void => {
    if (!currentMarkdown) {
      return;
    }

    if (currentMarkdown.text) {
      normalized.push(currentMarkdown);
    }

    currentMarkdown = undefined;
  };

  const pushPart = (part: ViewerResponsePart, insideThinking: boolean): void => {
    flushMarkdown();

    if (insideThinking && activeThinking) {
      activeThinking.children.push(part);
      return;
    }

    if (part.type !== 'thinking') {
      activeThinking = undefined;
    }

    normalized.push(part);
  };

  for (let index = 0; index < response.length; index += 1) {
    const part = response[index];

    if (typeof part === 'string') {
      if (activeThinking) {
        activeThinking = undefined;
      }

      currentMarkdown = appendMarkdownFragment(currentMarkdown, requestId, index, part, part);
      continue;
    }

    if (!isPlainObject(part)) {
      pushPart(createUnknownPart(createPartId(requestId, index, 'unknown'), 'Unknown response part', part), false);
      continue;
    }

    const kind = readString(part.kind);

    if (!kind) {
      const markdownText = readResponseTextFragment(part.value);
      if (markdownText !== undefined) {
        if (activeThinking) {
          activeThinking = undefined;
        }

        currentMarkdown = appendMarkdownFragment(currentMarkdown, requestId, index, markdownText, part);
        continue;
      }

      pushPart(createUnknownPart(createPartId(requestId, index, 'unknown'), 'Unknown response part', part), false);
      continue;
    }

    switch (kind) {
      case 'thinking': {
        const thinkingPart = createThinkingPart(createPartId(requestId, index, kind), part);
        if (!thinkingPart) {
          if (activeThinking) {
            activeThinking.done = true;
          }
          continue;
        }

        pushPart(thinkingPart, false);
        activeThinking = thinkingPart;
        continue;
      }
      case 'toolInvocationSerialized': {
        if (isToolHidden(part)) {
          continue;
        }

        const toolPart = createToolPart(createPartId(requestId, index, kind), part);
        pushPart(toolPart, shouldAttachToolToThinking(part, activeThinking));
        continue;
      }
      case 'textEditGroup': {
        const editPart = createEditPart(createPartId(requestId, index, kind), part);
        pushPart(editPart, Boolean(activeThinking));
        continue;
      }
      case 'inlineReference': {
        if (activeThinking) {
          activeThinking = undefined;
        }

        currentMarkdown = appendInlineReference(currentMarkdown, requestId, index, part);
        continue;
      }
      case 'codeblockUri': {
        if (currentMarkdown) {
          attachCodeBlockReference(currentMarkdown, part);
        } else {
          pushPart(createUnknownPart(createPartId(requestId, index, kind), kind, part), false);
        }
        continue;
      }
      case 'progressTaskSerialized': {
        pushPart(createProgressTaskPart(createPartId(requestId, index, kind), part), false);
        continue;
      }
      case 'confirmation': {
        pushPart(createConfirmationPart(createPartId(requestId, index, kind), part), false);
        continue;
      }
      case 'elicitationSerialized': {
        pushPart(createElicitationPart(createPartId(requestId, index, kind), part), false);
        continue;
      }
      case 'questionCarousel': {
        pushPart(createQuestionCarouselPart(createPartId(requestId, index, kind), part), false);
        continue;
      }
      case 'progressMessage': {
        pushPart(
          createNoticePart(
            createPartId(requestId, index, kind),
            'info',
            'Progress',
            extractMessageText(part.content) ?? 'In progress',
            part
          ),
          false
        );
        continue;
      }
      case 'warning': {
        pushPart(
          createNoticePart(
            createPartId(requestId, index, kind),
            'warning',
            'Warning',
            extractMessageText(part.content) ?? extractMessageText(part.message) ?? 'Warning',
            part
          ),
          false
        );
        continue;
      }
      case 'info': {
        pushPart(
          createNoticePart(
            createPartId(requestId, index, kind),
            'info',
            'Info',
            extractMessageText(part.content) ?? extractMessageText(part.message) ?? 'Info',
            part
          ),
          false
        );
        continue;
      }
      case 'undoStop':
      case 'mcpServersStarting':
      case 'clearToPreviousToolInvocation':
        continue;
      default:
        pushPart(createUnknownPart(createPartId(requestId, index, kind), kind, part), false);
        continue;
    }
  }

  flushMarkdown();
  activeThinking = undefined;

  const codeCitations = mapReferenceItems(request.codeCitations);
  if (codeCitations.length > 0) {
    normalized.push(createCodeCitationsPart(`${requestId}:synthetic:codeCitations`, codeCitations, request.codeCitations));
  }

  if (isPlainObject(request.result?.errorDetails)) {
    normalized.push(createErrorPart(`${requestId}:synthetic:error`, request.result.errorDetails));
  }

  const footerText = extractFooterText(request.result?.details);
  if (footerText) {
    normalized.push(createFooterPart(`${requestId}:synthetic:footer`, footerText, request.result?.details));
  }

  return normalized;
}

function mapAttachments(variables: unknown[] | undefined): ViewerAttachment[] {
  if (!Array.isArray(variables)) {
    return [];
  }

  return variables
    .map(mapAttachment)
    .filter((attachment): attachment is ViewerAttachment => Boolean(attachment));
}

function mapAttachment(value: unknown): ViewerAttachment | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const kind = readString(value.kind) ?? 'attachment';
  if (kind === 'workspace') {
    return undefined;
  }

  if ((kind === 'promptFile' || kind === 'promptText') && value.automaticallyAdded === true) {
    return undefined;
  }

  const label =
    readString(value.name)
    ?? readString(value.label)
    ?? readString(value.variableName)
    ?? extractUriLabel(value.uri)
    ?? extractUriLabel(value.value)
    ?? readString(value.text)
    ?? kind;

  const detail = readString(value.description) ?? readString(value.id);
  return { kind, label, detail };
}

function appendMarkdownFragment(
  current: ViewerMarkdownResponsePart | undefined,
  requestId: string,
  index: number,
  text: string,
  raw: unknown
): ViewerMarkdownResponsePart {
  const next = current ?? createMarkdownPart(createPartId(requestId, index, 'markdown'), '', raw);
  next.text += text;
  next.rawText = appendRawText(next.rawText, raw);

  if (isPlainObject(raw)) {
    next.baseUri ??= extractUri(raw.baseUri);
    next.uris = mergeUriMaps(next.uris, raw.uris);
  }

  return next;
}

function appendInlineReference(
  current: ViewerMarkdownResponsePart | undefined,
  requestId: string,
  index: number,
  part: Record<string, unknown>
): ViewerMarkdownResponsePart {
  const next = current ?? createMarkdownPart(createPartId(requestId, index, 'markdown'), '', part);
  const label = extractInlineReferenceLabel(part);
  const linkTarget = extractInlineReferenceLinkTarget(part);
  const referenceText = shouldRenderInlineReferenceAsPlainText(next.text, linkTarget)
    ? label
    : `[${escapeMarkdownLabel(label)}](${linkTarget})`;

  next.text += referenceText;
  next.rawText = appendRawText(next.rawText, part);
  return next;
}

function attachCodeBlockReference(current: ViewerMarkdownResponsePart, part: Record<string, unknown>): void {
  const label = extractUriLabel(part.uri) ?? 'Code block';
  current.codeBlocks ??= [];
  current.codeBlocks.push({
    label,
    isEdit: part.isEdit === true
  });
  current.rawText = appendRawText(current.rawText, part);
}

function createMarkdownPart(id: string, text: string, raw: unknown): ViewerMarkdownResponsePart {
  return {
    type: 'markdown',
    id,
    text,
    rawText: stringifyRaw(raw)
  };
}

function createThinkingPart(id: string, part: Record<string, unknown>): ViewerThinkingResponsePart | undefined {
  const text = extractTextValue(part.value);
  if (!text) {
    return undefined;
  }

  return {
    type: 'thinking',
    id,
    text,
    title: extractThinkingTitle(part, text),
    done: true,
    children: [],
    rawText: stringifyRaw(part)
  };
}

function createToolPart(id: string, part: Record<string, unknown>): ViewerToolResponsePart {
  return {
    type: 'tool',
    id,
    title: extractToolTitle(part),
    toolId: readString(part.toolId),
    status: extractToolStatus(part),
    detail: extractToolDetail(part),
    rawText: stringifyRaw(part)
  };
}

function createEditPart(id: string, part: Record<string, unknown>): ViewerEditResponsePart {
  const uri = extractUriLabel(part.uri);
  const edits = extractTextEdits(part.edits);
  const editCount = edits.length > 0 ? edits.length : undefined;
  const status = part.done === false ? 'pending' : 'completed';
  const countLabel = typeof editCount === 'number' ? `${editCount} edit${editCount === 1 ? '' : 's'}` : 'edits';

  return {
    type: 'edit',
    id,
    summary: uri ? `${uri} (${countLabel}, ${status})` : `${countLabel}, ${status}`,
    uri,
    status,
    editCount,
    edits,
    rawText: stringifyRaw(part)
  };
}

function createProgressTaskPart(id: string, part: Record<string, unknown>): ViewerProgressTaskResponsePart {
  const entries = Array.isArray(part.progress)
    ? part.progress
        .map(extractProgressEntry)
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const title = extractMessageText(part.content) ?? 'Progress task';

  return {
    type: 'progressTask',
    id,
    title,
    entries: entries.length > 0 ? entries : [title],
    rawText: stringifyRaw(part)
  };
}

function createConfirmationPart(id: string, part: Record<string, unknown>): ViewerConfirmationResponsePart {
  return {
    type: 'confirmation',
    id,
    title: readString(part.title) ?? 'Confirmation',
    message: extractMessageText(part.message),
    buttons: Array.isArray(part.buttons)
      ? part.buttons.map((button) => readString(button)).filter((button): button is string => Boolean(button))
      : [],
    isUsed: part.isUsed === true,
    rawText: stringifyRaw(part)
  };
}

function createElicitationPart(id: string, part: Record<string, unknown>): ViewerElicitationResponsePart {
  return {
    type: 'elicitation',
    id,
    title: extractMessageText(part.title) ?? 'User input',
    message: extractMessageText(part.message),
    state: readString(part.state),
    acceptedResult: part.acceptedResult === undefined ? undefined : stringifyRaw(part.acceptedResult),
    rawText: stringifyRaw(part)
  };
}

function createQuestionCarouselPart(id: string, part: Record<string, unknown>): ViewerQuestionCarouselResponsePart {
  const questions = Array.isArray(part.questions)
    ? part.questions
        .map((question) => mapQuestion(question, part.data))
        .filter((value): value is ViewerQuestionCarouselQuestion => Boolean(value))
    : [];

  return {
    type: 'questionCarousel',
    id,
    questions,
    allowSkip: part.allowSkip === true,
    isUsed: part.isUsed === true,
    rawText: stringifyRaw(part)
  };
}

function createReferencesPart(id: string, title: string, items: ViewerReferenceItem[], raw: unknown): ViewerReferencesResponsePart {
  return {
    type: 'references',
    id,
    title,
    items,
    rawText: stringifyRaw(raw)
  };
}

function createCodeCitationsPart(id: string, items: ViewerReferenceItem[], raw: unknown): ViewerCodeCitationsResponsePart {
  return {
    type: 'codeCitations',
    id,
    items,
    rawText: stringifyRaw(raw)
  };
}

function createErrorPart(id: string, errorDetails: unknown): ViewerErrorResponsePart {
  const errorObject = isPlainObject(errorDetails) ? errorDetails : undefined;

  return {
    type: 'error',
    id,
    title: readString(errorObject?.code) ?? 'Error',
    message: readString(errorObject?.message) ?? stringifyRaw(errorDetails),
    buttons: Array.isArray(errorObject?.confirmationButtons)
      ? errorObject.confirmationButtons
          .map((button) => isPlainObject(button) ? readString(button.label) : undefined)
          .filter((label): label is string => Boolean(label))
      : undefined,
    rawText: stringifyRaw(errorDetails)
  };
}

function createFooterPart(id: string, text: string, raw: unknown): ViewerFooterResponsePart {
  return {
    type: 'footer',
    id,
    text,
    rawText: stringifyRaw(raw)
  };
}

function createNoticePart(
  id: string,
  tone: ViewerNoticeResponsePart['tone'],
  title: string,
  text: string,
  raw: unknown
): ViewerNoticeResponsePart {
  return {
    type: 'notice',
    id,
    tone,
    title,
    text,
    rawText: stringifyRaw(raw)
  };
}

function createUnknownPart(id: string, label: string, raw: unknown): ViewerUnknownResponsePart {
  return {
    type: 'unknown',
    id,
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
    return readString(value.value);
  }

  return undefined;
}

function extractToolTitle(part: Record<string, unknown>): string {
  return (
    extractMessageText(part.pastTenseMessage)
    ?? extractMessageText(part.invocationMessage)
    ?? readString(part.generatedTitle)
    ?? readString(part.toolId)
    ?? 'Tool invocation'
  );
}

function extractToolStatus(part: Record<string, unknown>): ViewerToolResponsePart['status'] {
  const confirmation = isPlainObject(part.isConfirmed) ? part.isConfirmed : undefined;
  if (readNumber(confirmation?.type) === 0) {
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

function extractThinkingTitle(part: Record<string, unknown>, text: string): string {
  return readString(part.generatedTitle) ?? extractBoldHeading(text) ?? 'Thinking';
}

function extractToolDetail(part: Record<string, unknown>): ViewerToolResponsePart['detail'] {
  const toolSpecificData = isPlainObject(part.toolSpecificData) ? part.toolSpecificData : undefined;
  const resultDetails = part.resultDetails;

  if (toolSpecificData && readString(toolSpecificData.kind) === 'terminal') {
    const terminalState = isPlainObject(toolSpecificData.terminalCommandState) ? toolSpecificData.terminalCommandState : undefined;

    return {
      kind: 'terminal',
      command: extractTerminalCommand(toolSpecificData),
      cwd: extractUriLabel(toolSpecificData.cwd),
      exitCode: readNumber(terminalState?.exitCode),
      output: extractTerminalOutput(toolSpecificData),
      durationMs: readNumber(toolSpecificData.durationMs) ?? readNumber(terminalState?.durationMs),
      language: readString(toolSpecificData.language),
      isBackground: toolSpecificData.isBackground === true
    };
  }

  if (toolSpecificData && readString(toolSpecificData.kind) === 'todoList') {
    return {
      kind: 'todoList',
      items: Array.isArray(toolSpecificData.todoList)
        ? toolSpecificData.todoList
            .map((item) => mapTodoItem(item))
            .filter((item): item is NonNullable<ReturnType<typeof mapTodoItem>> => Boolean(item))
        : []
    };
  }

  if (toolSpecificData && readString(toolSpecificData.kind) === 'subagent') {
    return {
      kind: 'subagent',
      agentName: readString(toolSpecificData.agentName),
      description: readString(toolSpecificData.description),
      prompt: readString(toolSpecificData.prompt),
      result: typeof toolSpecificData.result === 'string' ? toolSpecificData.result : stringifyOptional(toolSpecificData.result),
      modelName: readString(toolSpecificData.modelName)
    };
  }

  if (toolSpecificData && readString(toolSpecificData.kind) === 'input') {
    return {
      kind: 'input',
      rawInput: typeof toolSpecificData.rawInput === 'string' ? toolSpecificData.rawInput : stringifyOptional(toolSpecificData.rawInput),
      mcpAppData: stringifyOptional(toolSpecificData.mcpAppData)
    };
  }

  const ioDetail = extractInputOutputDetail(resultDetails);
  if (ioDetail) {
    return ioDetail;
  }

  const uriList = extractResultUriList(resultDetails);
  if (uriList.length > 0) {
    return {
      kind: 'uris',
      items: uriList
    };
  }

  const messageText = extractMessageText(part.pastTenseMessage) ?? extractMessageText(part.invocationMessage);
  if (messageText) {
    return {
      kind: 'text',
      text: messageText
    };
  }

  if (toolSpecificData) {
    return {
      kind: 'unknown',
      text: stringifyRaw(toolSpecificData)
    };
  }

  return undefined;
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

function extractUri(value: unknown): ViewerUri | undefined {
  if (typeof value === 'string') {
    return createUri({ label: value, external: value });
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const label = extractUriLabel(value);
  if (!label) {
    return undefined;
  }

  return createUri({
    label,
    scheme: readString(value.scheme),
    path: readString(value.path),
    fsPath: readString(value.fsPath),
    external: readString(value.external)
  });
}

function createUri(value: ViewerUri): ViewerUri {
  return value;
}

function mapReferenceItems(values: unknown[] | undefined): ViewerReferenceItem[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(mapReferenceItem)
    .filter((item): item is ViewerReferenceItem => Boolean(item));
}

function mapReferenceItem(value: unknown): ViewerReferenceItem | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const referenceValue = value.reference ?? value.inlineReference ?? value.uri ?? value.location ?? value;
  const uri = extractReferenceUri(referenceValue);
  const label =
    readString(value.name)
    ?? extractReferenceName(referenceValue)
    ?? uri?.label;

  if (!label) {
    return undefined;
  }

  return {
    label,
    detail: readString(value.kind),
    uri
  };
}

function extractReferenceUri(value: unknown): ViewerUri | undefined {
  if (!isPlainObject(value)) {
    return extractUri(value);
  }

  if (isPlainObject(value.uri)) {
    return extractUri(value.uri);
  }

  return extractUri(value);
}

function extractReferenceName(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return (
    readString(value.name)
    ?? readString(value.label)
    ?? readString(value.containerName)
    ?? readString(value.value)
  );
}

function extractInlineReferenceLabel(part: Record<string, unknown>): string {
  return (
    readString(part.name)
    ?? extractReferenceName(part.inlineReference)
    ?? extractUriLabel(part.inlineReference)
    ?? 'reference'
  );
}

function extractInlineReferenceLinkTarget(part: Record<string, unknown>): string | undefined {
  return extractInlineReferenceUri(part.inlineReference);
}

function extractInlineReferenceUri(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (isPlainObject(value.location) && isPlainObject(value.location.uri)) {
    return readString(value.location.uri.external);
  }

  return readString(value.external) ?? readString(value.path);
}

function shouldRenderInlineReferenceAsPlainText(currentText: string, linkTarget: string | undefined): boolean {
  if (!linkTarget || !/^https?:/i.test(linkTarget)) {
    return true;
  }

  const fencedBlockCount = (currentText.match(/(^|\n)```/g) ?? []).length;
  if (fencedBlockCount % 2 === 1) {
    return true;
  }

  const lastLine = currentText.split(/\r?\n/).pop() ?? '';
  const inlineBacktickCount = (lastLine.match(/`/g) ?? []).length;
  return inlineBacktickCount % 2 === 1;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\[\]])/g, '\\$1');
}

function shouldAttachToolToThinking(part: Record<string, unknown>, activeThinking: ViewerThinkingResponsePart | undefined): boolean {
  if (!activeThinking) {
    return false;
  }

  const toolId = readString(part.toolId) ?? '';
  if (toolId.startsWith('mcp_')) {
    return false;
  }

  const toolSpecificData = isPlainObject(part.toolSpecificData) ? part.toolSpecificData : undefined;
  return readString(toolSpecificData?.kind) !== 'subagent';
}

function isToolHidden(part: Record<string, unknown>): boolean {
  const presentation = readString(part.presentation);
  if (presentation === 'hidden') {
    return true;
  }

  return presentation === 'hiddenAfterComplete' && part.isComplete === true;
}

function extractTextEdits(value: unknown): NonNullable<ViewerEditResponsePart['edits']> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((group) => {
    if (!Array.isArray(group)) {
      return [];
    }

    return group
      .map((entry) => {
        if (!isPlainObject(entry)) {
          return undefined;
        }

        const text = readString(entry.text) ?? '';
        const range = isPlainObject(entry.range) ? entry.range : undefined;
        return {
          rangeLabel: formatEditRange(range),
          text
        };
      })
      .filter((entry): entry is { rangeLabel: string; text: string } => Boolean(entry));
  });
}

function formatEditRange(range: Record<string, unknown> | undefined): string {
  if (!range) {
    return 'Unknown range';
  }

  const startLine = readNumber(range.startLineNumber);
  const startColumn = readNumber(range.startColumn);
  const endLine = readNumber(range.endLineNumber);
  const endColumn = readNumber(range.endColumn);

  if (
    startLine === undefined
    || startColumn === undefined
    || endLine === undefined
    || endColumn === undefined
  ) {
    return 'Unknown range';
  }

  return `${startLine}:${startColumn}-${endLine}:${endColumn}`;
}

function extractProgressEntry(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  return extractMessageText(value.content) ?? extractMessageText(value.message) ?? readString(value.label);
}

function mapQuestion(question: unknown, data: unknown): ViewerQuestionCarouselQuestion | undefined {
  if (!isPlainObject(question)) {
    return undefined;
  }

  const answerMap = isPlainObject(data) ? data : undefined;
  const questionId = readString(question.id);

  return {
    id: questionId,
    type: readString(question.type) ?? 'unknown',
    title: readString(question.title) ?? 'Question',
    message: readString(question.message),
    options: Array.isArray(question.options)
      ? question.options
          .map((option) => isPlainObject(option) ? readString(option.label) ?? readString(option.value) : undefined)
          .filter((option): option is string => Boolean(option))
      : [],
    answer: questionId && answerMap ? extractQuestionAnswer(answerMap[questionId]) : undefined
  };
}

function extractQuestionAnswer(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const answers = value.filter((entry): entry is string => typeof entry === 'string');
  return answers.length > 0 ? answers : undefined;
}

function extractFooterText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  return readString(value.value) ?? readString(value.details) ?? stringifyOptional(value);
}

function extractInputOutputDetail(value: unknown): ViewerToolResponsePart['detail'] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const input = typeof value.input === 'string' ? value.input : undefined;
  const output = typeof value.output === 'string' ? value.output : undefined;
  if (!input && !output) {
    return undefined;
  }

  return {
    kind: 'io',
    input,
    inputLanguage: readString(value.inputLanguage),
    output,
    isError: value.isError === true
  };
}

function extractResultUriList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (isPlainObject(entry) && isPlainObject(entry.uri)) {
        return extractUriLabel(entry.uri);
      }

      return extractUriLabel(entry);
    })
    .filter((label): label is string => Boolean(label));
}

function extractTerminalCommand(value: Record<string, unknown>): string | undefined {
  const commandLine = isPlainObject(value.commandLine) ? value.commandLine : undefined;
  const confirmation = isPlainObject(value.confirmation) ? value.confirmation : undefined;

  return (
    readString(value.displayCommandLine)
    ?? readString(commandLine?.displayOverride)
    ?? readString(commandLine?.displayString)
    ?? readString(commandLine?.userEdited)
    ?? readString(commandLine?.toolEdited)
    ?? readString(commandLine?.original)
    ?? readString(value.command)
    ?? readString(confirmation?.commandLine)
  );
}

function extractTerminalOutput(value: Record<string, unknown>): string | undefined {
  const terminalState = isPlainObject(value.terminalCommandState) ? value.terminalCommandState : undefined;

  return (
    readString(value.output)
    ?? readString(terminalState?.output)
    ?? readString(terminalState?.stderr)
  );
}

function mapTodoItem(value: unknown): { id: string; title: string; status: string } | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const id = readString(value.id) ?? stringifyOptional(value.id);
  const title = readString(value.title);
  const status = readString(value.status);

  if (!id || !title || !status) {
    return undefined;
  }

  return { id, title, status };
}

function appendRawText(current: string | undefined, raw: unknown): string {
  const serialized = stringifyRaw(raw);
  return current ? `${current}\n${serialized}` : serialized;
}

function mergeUriMaps(
  current: ViewerMarkdownResponsePart['uris'],
  value: unknown
): ViewerMarkdownResponsePart['uris'] {
  if (!isPlainObject(value)) {
    return current;
  }

  const next = { ...(current ?? {}) };

  for (const [key, uriValue] of Object.entries(value)) {
    const uri = extractUri(uriValue);
    if (uri) {
      next[key] = uri;
    }
  }

  return Object.keys(next).length > 0 ? next : current;
}

function createPartId(requestId: string, index: number, kind: string): string {
  return `${requestId}:${index}:${kind}`;
}

function extractBoldHeading(text: string): string | undefined {
  const match = text.match(/\*\*([^*\n]+)\*\*/);
  return match ? match[1].trim() : undefined;
}

function stringifyOptional(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return stringifyRaw(value);
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

function readResponseTextFragment(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}