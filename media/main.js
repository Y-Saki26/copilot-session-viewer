import {
  escapeHtml,
  formatMultilineText,
  normalizeDetailRendererDependencies,
  renderMarkdownToHtml as renderMarkdownFragment,
  setDetailDisclosuresOpen
} from './detailRendererShared.mjs';
import { filterVisibleSessions } from './sessionListShared.mjs';

const vscode = acquireVsCodeApi();
const persistedState = vscode.getState() || {};
const state = {
  expandedWorkspaces: isPlainObject(persistedState.expandedWorkspaces) ? persistedState.expandedWorkspaces : {},
  selectedSessionPath: typeof persistedState.selectedSessionPath === 'string' ? persistedState.selectedSessionPath : undefined,
  showEmptySessions: persistedState.showEmptySessions === true
};
let markedLibrary;
let domPurifyLibrary;
let highlightLibrary;
let detailRendererRuntime;
const viewMode = document.body.getAttribute('data-view') || 'sessions';

installWebviewErrorForwarding();

if (viewMode === 'session-detail') {
  initSessionDetailView();
} else {
  initSessionsView();
}

function initSessionsView() {
  let currentScan;
  const workspaceSessions = new Map();
  const workspaceWarnings = new Map();
  const workspaceErrors = new Map();
  const loadingWorkspaces = new Set();

  const refreshButton = document.getElementById('refreshButton');
  const settingsButton = document.getElementById('settingsButton');
  const showEmptySessionsCheckbox = document.getElementById('showEmptySessionsCheckbox');
  const summary = document.getElementById('summary');
  const warnings = document.getElementById('warnings');
  const sessions = document.getElementById('sessions');

  if (!refreshButton || !settingsButton || !showEmptySessionsCheckbox || !summary || !warnings || !sessions) {
    return;
  }

  showEmptySessionsCheckbox.checked = state.showEmptySessions;

  refreshButton.addEventListener('click', function () {
    resetWorkspaceState();
    renderLoading('Refreshing sessions...');
    vscode.postMessage({ type: 'refresh' });
  });

  settingsButton.addEventListener('click', function () {
    vscode.postMessage({ type: 'openSettings' });
  });

  showEmptySessionsCheckbox.addEventListener('change', function () {
    state.showEmptySessions = showEmptySessionsCheckbox.checked;
    persistState();
    if (currentScan) {
      renderScan(currentScan);
    }
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'scanResult') {
      renderScan(message.value);
      return;
    }

    if (message.type === 'workspaceSessionsLoaded') {
      workspaceSessions.set(message.value.chatSessionsDir, Array.isArray(message.value.sessions) ? message.value.sessions : []);
      workspaceWarnings.set(message.value.chatSessionsDir, Array.isArray(message.value.warnings) ? message.value.warnings : []);
      workspaceErrors.delete(message.value.chatSessionsDir);
      loadingWorkspaces.delete(message.value.chatSessionsDir);
      if (currentScan) {
        renderScan(currentScan);
      }
      return;
    }

    if (message.type === 'workspaceSessionsError') {
      workspaceErrors.set(message.value.chatSessionsDir, message.value.message || 'Failed to load sessions.');
      workspaceWarnings.delete(message.value.chatSessionsDir);
      loadingWorkspaces.delete(message.value.chatSessionsDir);
      if (currentScan) {
        renderScan(currentScan);
      }
      return;
    }

    if (message.type === 'scanError') {
      renderError(message.value);
    }
  });

  vscode.postMessage({ type: 'ready' });
  renderLoading('Waiting for session scan...');

  function renderLoading(text) {
    summary.innerHTML = '<div class="card">' + escapeHtml(text) + '</div>';
    warnings.innerHTML = '';
    sessions.innerHTML = '';
  }

  function renderError(text) {
    summary.innerHTML = '<div class="card error">' + escapeHtml(text) + '</div>';
    warnings.innerHTML = '';
    sessions.innerHTML = '';
  }

  function renderScan(scan) {
    currentScan = scan;
    syncWorkspaceState(scan.workspaces);

    summary.innerHTML = [
      '<details class="card scan-details">',
      '<summary>',
      '<span>Scan details</span>',
      '<span class="meta">' + escapeHtml(scan.loadedFromCache ? 'Cache' : 'Live') + ' · ' + escapeHtml(String(scan.workspaceCount)) + ' workspace(s)</span>',
      '</summary>',
      '<div class="scan-details-content">',
      '<div class="metrics">',
      metric('Source', scan.loadedFromCache ? 'Cache' : 'Live'),
      metric('Roots', String(scan.rootsScanned.length)),
      metric('Workspaces', String(scan.workspaceCount)),
      metric('Stored logs', String(scan.sessionCount)),
      metric('Scanned', formatDate(scan.scannedAt)),
      '</div>',
      '<div class="roots"><strong>Roots</strong><ul>' + scan.rootsScanned.map(function (root) {
        return '<li>' + escapeHtml(root) + '</li>';
      }).join('') + '</ul></div>',
      '</div>',
      '</details>'
    ].join('');

    if (Array.isArray(scan.warnings) && scan.warnings.length > 0) {
      warnings.innerHTML = '<div class="card warning"><strong>Warnings</strong><ul>' + scan.warnings.map(function (warning) {
        return '<li><span>' + escapeHtml(warning.message) + '</span><code>' + escapeHtml(warning.location) + '</code></li>';
      }).join('') + '</ul></div>';
    } else {
      warnings.innerHTML = '';
    }

    if (!Array.isArray(scan.workspaces) || scan.workspaces.length === 0) {
      sessions.innerHTML = '<div class="card empty">No saved chat sessions were found in the configured roots.</div>';
      return;
    }

    sessions.innerHTML = '<div class="workspace-groups">' + scan.workspaces.map(function (workspace) {
      const workspaceKey = workspace.chatSessionsDir;
      const isExpanded = Boolean(state.expandedWorkspaces[workspaceKey]);
      const loadedSessions = workspaceSessions.get(workspaceKey);
      const visibleSessions = filterVisibleSessions(loadedSessions, state.showEmptySessions);
      const loadWarnings = workspaceWarnings.get(workspaceKey) || [];
      const loadError = workspaceErrors.get(workspaceKey);
      const isLoading = loadingWorkspaces.has(workspaceKey);

      return [
        '<details class="workspace-group" data-workspace-key="' + escapeHtml(workspaceKey) + '"' + (isExpanded ? ' open' : '') + '>',
        '<summary class="workspace-header">',
        '<span class="workspace-chevron" aria-hidden="true">▾</span>',
        '<div class="workspace-main">',
        '<h2>' + escapeHtml(workspace.workspaceName) + '</h2>',
        workspace.workspaceFolder ? '<p class="path">' + escapeHtml(workspace.workspaceFolder) + '</p>' : '',
        '</div>',
        '<div class="workspace-stats">',
        '<strong>' + escapeHtml(String(Array.isArray(loadedSessions) ? visibleSessions.length : workspace.sessionCount)) + '</strong>',
        '<span>' + (Array.isArray(loadedSessions) ? 'shown' : 'logs') + '</span>',
        '</div>',
        '</summary>',
        '<div class="list">',
        renderWorkspaceBody(workspace, loadedSessions, visibleSessions, loadWarnings, loadError, isLoading),
        '</div>',
        '</details>'
      ].join('');
    }).join('') + '</div>';

    attachWorkspaceToggleListeners(sessions, requestWorkspaceSessions);
    attachSessionSelectionListeners(sessions, findSessionSummaryBySourcePath);
  }

  function renderWorkspaceBody(workspace, loadedSessions, visibleSessions, loadWarnings, loadError, isLoading) {
    if (isLoading) {
      return '<div class="card">Loading session summaries...</div>';
    }

    if (loadError) {
      return '<div class="card error">' + escapeHtml(loadError) + '</div>';
    }

    if (!Array.isArray(loadedSessions)) {
      return '<div class="card">Expand this workspace to load its session list.</div>';
    }

    const sessionListMarkup = visibleSessions.length === 0
      ? '<div class="card empty">' + (loadedSessions.length === 0
        ? 'No readable session files were found in this workspace.'
        : 'No sessions with stored requests were found in this workspace.') + '</div>'
      : visibleSessions.map(function (session) {
        const selectedClass = session.sourcePath === state.selectedSessionPath ? ' selected' : '';
        return [
          '<button type="button" class="session-card' + selectedClass + '" data-source-path="' + escapeHtml(session.sourcePath) + '">',
          '<span class="session-title">' + escapeHtml(session.title) + '</span>',
          '<span class="meta">Updated ' + escapeHtml(formatDate(session.updatedAt)) + '</span>',
          session.createdAt ? '<span class="meta">Created ' + escapeHtml(formatDate(session.createdAt)) + '</span>' : '',
          '<span class="path">Source: ' + escapeHtml(session.sourcePath) + '</span>',
          '</button>'
        ].join('');
      }).join('');

    return sessionListMarkup + renderWorkspaceWarnings(loadWarnings);
  }

  function renderWorkspaceWarnings(loadWarnings) {
    if (!Array.isArray(loadWarnings) || loadWarnings.length === 0) {
      return '';
    }

    return '<div class="card warning"><strong>Workspace warnings</strong><ul>' + loadWarnings.map(function (warning) {
      return '<li><span>' + escapeHtml(warning.message) + '</span><code>' + escapeHtml(warning.location) + '</code></li>';
    }).join('') + '</ul></div>';
  }

  function syncWorkspaceState(workspaces) {
    const validKeys = new Set(Array.isArray(workspaces) ? workspaces.map(function (workspace) {
      return workspace.chatSessionsDir;
    }) : []);

    Array.from(workspaceSessions.keys()).forEach(function (workspaceKey) {
      if (!validKeys.has(workspaceKey)) {
        workspaceSessions.delete(workspaceKey);
        workspaceWarnings.delete(workspaceKey);
        workspaceErrors.delete(workspaceKey);
        loadingWorkspaces.delete(workspaceKey);
        delete state.expandedWorkspaces[workspaceKey];
      }
    });
  }

  function resetWorkspaceState() {
    currentScan = undefined;
    workspaceSessions.clear();
    workspaceWarnings.clear();
    workspaceErrors.clear();
    loadingWorkspaces.clear();
    state.expandedWorkspaces = {};
    state.selectedSessionPath = undefined;
    persistState();
  }

  function requestWorkspaceSessions(workspaceKey) {
    if (workspaceSessions.has(workspaceKey) || loadingWorkspaces.has(workspaceKey)) {
      return;
    }

    loadingWorkspaces.add(workspaceKey);
    workspaceWarnings.delete(workspaceKey);
    workspaceErrors.delete(workspaceKey);

    if (currentScan) {
      renderScan(currentScan);
    }

    vscode.postMessage({ type: 'loadWorkspaceSessions', chatSessionsDir: workspaceKey });
  }

  function findSessionSummaryBySourcePath(sourcePath) {
    for (const sessionsForWorkspace of workspaceSessions.values()) {
      const match = sessionsForWorkspace.find(function (session) {
        return session.sourcePath === sourcePath;
      });

      if (match) {
        return match;
      }
    }

    return undefined;
  }
}

async function initSessionDetailView() {
  const detailSummary = document.getElementById('detailSummary');
  const detailTurns = document.getElementById('detailTurns');
  const collapseMessagesButton = document.getElementById('collapseMessagesButton');
  const expandMessagesButton = document.getElementById('expandMessagesButton');

  if (!detailSummary || !detailTurns || !collapseMessagesButton || !expandMessagesButton) {
    return;
  }

  try {
    await ensureDetailRendererRuntime();
  } catch (error) {
    renderRuntimeError(error);
    return;
  }

  detailTurns.addEventListener('click', handleDetailLinkClick);
  collapseMessagesButton.addEventListener('click', function () {
    setDetailDisclosuresOpen(detailTurns, false);
  });
  expandMessagesButton.addEventListener('click', function () {
    setDetailDisclosuresOpen(detailTurns, true);
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'sessionDocumentLoading') {
      renderLoadingState(message.value);
      return;
    }

    if (message.type === 'sessionDocument') {
      renderDocument(message.value);
      return;
    }

    if (message.type === 'sessionDocumentError') {
      renderErrorState(message.value);
    }
  });

  vscode.postMessage({ type: 'ready' });
  renderLoadingState({
    title: 'Conversation Viewer',
    message: 'Select a session from the sidebar to restore the conversation.'
  });

  function renderRuntimeError(error) {
    const message = error instanceof Error ? error.message : 'Failed to load the session detail renderer.';
    postClientLog('error', 'Session detail renderer failed to initialize.', error);
    detailSummary.innerHTML = [
      '<div class="card error">',
      '<p class="workspace-label">Error</p>',
      '<h2>Session Detail Unavailable</h2>',
      '<p class="subtitle">' + escapeHtml(message) + '</p>',
      '</div>'
    ].join('');
    detailTurns.innerHTML = '';
    setDetailActionsEnabled(false);
  }

  function renderLoadingState(viewState) {
    detailSummary.innerHTML = [
      '<div class="card">',
      '<p class="workspace-label">Status</p>',
      '<h2>' + escapeHtml(viewState.title || 'Loading') + '</h2>',
      '<p class="subtitle">' + escapeHtml(viewState.message || 'Loading...') + '</p>',
      '</div>'
    ].join('');
    detailTurns.innerHTML = '';
    setDetailActionsEnabled(false);
  }

  function renderErrorState(viewState) {
    detailSummary.innerHTML = [
      '<div class="card error">',
      '<p class="workspace-label">Error</p>',
      '<h2>' + escapeHtml(viewState.title || 'Session Error') + '</h2>',
      '<p class="subtitle">' + escapeHtml(viewState.message || 'Unknown error') + '</p>',
      '</div>'
    ].join('');
    detailTurns.innerHTML = '';
    setDetailActionsEnabled(false);
  }

  function renderDocument(documentValue) {
    const responderName = documentValue.responderUsername || 'Assistant';
    const turnCount = Array.isArray(documentValue.turns) ? documentValue.turns.length : 0;
    detailSummary.innerHTML = [
      '<details class="card scan-details detail-scan-details">',
      '<summary>',
      '<span>Session details</span>',
      '<span class="meta">' + escapeHtml(String(turnCount)) + ' turn(s) · ' + escapeHtml(responderName) + '</span>',
      '</summary>',
      '<div class="scan-details-content">',
      '<div class="metrics detail-metrics">',
      metric('Workspace', documentValue.workspaceName || 'Unknown'),
      metric('Turns', String(turnCount)),
      metric('Created', formatDate(documentValue.createdAt)),
      metric('Updated', formatDate(documentValue.updatedAt)),
      metric('Responder', responderName),
      '</div>',
      '</div>',
      '</details>',
      '<div class="card detail-meta-card">',
      '<p class="workspace-label">Session</p>',
      '<h2>' + escapeHtml(documentValue.title || 'Untitled session') + '</h2>',
      documentValue.workspaceFolder ? '<p class="path">Workspace: ' + escapeHtml(documentValue.workspaceFolder) + '</p>' : '',
      '<p class="path">Source: ' + escapeHtml(documentValue.sourcePath || 'Unknown') + '</p>',
      '</div>'
    ].join('');

    if (!Array.isArray(documentValue.turns) || documentValue.turns.length === 0) {
      detailTurns.innerHTML = '<div class="card empty">This session does not have any stored requests yet.</div>';
      setDetailActionsEnabled(false);
      return;
    }

    detailTurns.innerHTML = '<div class="turn-list">' + documentValue.turns.map(function (turn, index) {
      return renderTurn(turn, index, responderName);
    }).join('') + '</div>';
    setDetailActionsEnabled(true);
  }

  function setDetailActionsEnabled(enabled) {
    collapseMessagesButton.disabled = !enabled;
    expandMessagesButton.disabled = !enabled;
  }
}

function attachWorkspaceToggleListeners(container, onExpand) {
  Array.from(container.querySelectorAll('.workspace-group')).forEach(function (element) {
    element.addEventListener('toggle', function () {
      const workspaceKey = element.getAttribute('data-workspace-key');
      if (!workspaceKey) {
        return;
      }

      state.expandedWorkspaces[workspaceKey] = element.open;
      persistState();

      if (element.open && typeof onExpand === 'function') {
        onExpand(workspaceKey);
      }
    });
  });
}

function attachSessionSelectionListeners(container, resolveSessionSummary) {
  Array.from(container.querySelectorAll('.session-card')).forEach(function (element) {
    element.addEventListener('click', function () {
      const sourcePath = element.getAttribute('data-source-path');
      if (!sourcePath) {
        return;
      }

      state.selectedSessionPath = sourcePath;
      persistState();
      updateSelectedSession(sourcePath, container);
      vscode.postMessage({
        type: 'selectSession',
        sourcePath: sourcePath,
        session: typeof resolveSessionSummary === 'function' ? resolveSessionSummary(sourcePath) : undefined
      });
    });
  });
}

function updateSelectedSession(sourcePath, container) {
  Array.from(container.querySelectorAll('.session-card')).forEach(function (element) {
    if (element.getAttribute('data-source-path') === sourcePath) {
      element.classList.add('selected');
    } else {
      element.classList.remove('selected');
    }
  });
}

function renderMarkdownToHtml(markdownText, codeBlocks) {
  return renderMarkdownFragment(markdownText, codeBlocks, {
    markedLibrary: markedLibrary,
    domPurifyLibrary: domPurifyLibrary,
    highlightLibrary: highlightLibrary
  });
}

function renderTurn(turn, index, responderName) {
  return [
    '<details class="turn" open>',
    '<summary class="turn-header">',
    '<span class="turn-label">Turn ' + escapeHtml(String(index + 1)) + '</span>',
    '<span class="meta">' + escapeHtml(formatDate(turn.timestamp)) + '</span>',
    '</summary>',
    '<div class="turn-content">',
    renderUserMessage(turn),
    renderAssistantMessage(turn, responderName),
    '</div>',
    '</details>'
  ].join('');
}

function renderUserMessage(turn) {
  return [
    '<details class="message message-user" open>',
    renderMessageSummary('User', summarizeText(turn.userText)),
    '<div class="message-content">',
    '<div class="message-body">' + formatMultilineText(turn.userText) + '</div>',
    renderAttachments(turn.attachments),
    '</div>',
    '</details>'
  ].join('');
}

function renderAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }

  return '<div class="attachments">' + attachments.map(function (attachment) {
    const detail = attachment.detail ? '<span class="attachment-detail">' + escapeHtml(attachment.detail) + '</span>' : '';
    return '<span class="attachment-pill"><strong>' + escapeHtml(attachment.kind) + '</strong><span>' + escapeHtml(attachment.label) + '</span>' + detail + '</span>';
  }).join('') + '</div>';
}

function renderAssistantMessage(turn, responderName) {
  if (!Array.isArray(turn.responseParts) || turn.responseParts.length === 0) {
    return [
      '<details class="message message-assistant" open>',
      renderMessageSummary(responderName, 'No captured response content'),
      '<div class="message-content">',
      '<div class="message-body muted-copy">No assistant response content was captured for this turn.</div>',
      '</div>',
      '</details>'
    ].join('');
  }

  return [
    '<details class="message message-assistant response-shell" open>',
    renderMessageSummary(responderName, String(turn.responseParts.length) + ' response part(s)'),
    '<div class="message-content">',
    '<div class="response-parts">' + turn.responseParts.map(renderResponsePart).join('') + '</div>',
    '</div>',
    '</details>'
  ].join('');
}

function renderMessageSummary(role, preview) {
  return [
    '<summary class="message-header">',
    '<span class="message-role">' + escapeHtml(role) + '</span>',
    preview ? '<span class="message-preview">' + escapeHtml(preview) + '</span>' : '',
    '</summary>'
  ].join('');
}

function summarizeText(value) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) {
    return normalized;
  }

  return normalized.slice(0, 77) + '...';
}

function renderResponsePart(part) {
  switch (part.type) {
    case 'markdown':
      return '<section class="response-part markdown-part">' + renderMarkdownToHtml(part.text, part.codeBlocks) + '</section>';
    case 'thinking':
      return renderThinkingPart(part);
    case 'subagent':
      return renderSubagentPart(part);
    case 'tool':
      return renderToolPart(part);
    case 'edit':
      return renderEditPart(part);
    case 'progressTask':
      return renderProgressTaskPart(part);
    case 'confirmation':
      return renderConfirmationPart(part);
    case 'elicitation':
      return renderElicitationPart(part);
    case 'questionCarousel':
      return renderQuestionCarouselPart(part);
    case 'references':
      return renderReferencesPart(part);
    case 'codeCitations':
      return renderCodeCitationsPart(part);
    case 'error':
      return renderErrorPart(part);
    case 'footer':
      return '<footer class="response-part response-footer">' + renderMarkdownToHtml(part.text) + '</footer>';
    case 'notice':
      return renderNoticePart(part);
    case 'unknown':
      return renderUnknownPart(part);
    default:
      return '';
  }
}

function renderThinkingPart(part) {
  return [
    '<details class="response-part thinking-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Thinking</span>',
    '<span class="part-title">' + escapeHtml(part.title) + '</span>',
    '<span class="part-status">✓</span>',
    '</summary>',
    '<div class="part-body">',
    '<div class="markdown-content">' + renderMarkdownToHtml(part.text) + '</div>',
    Array.isArray(part.children) && part.children.length > 0 ? '<div class="nested-parts">' + part.children.map(renderResponsePart).join('') + '</div>' : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderSubagentPart(part) {
  return [
    '<details class="response-part subagent-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Subagent</span>',
    '<span class="part-title">' + escapeHtml(part.title) + '</span>',
    '<span class="part-status">✓</span>',
    '</summary>',
    '<div class="part-body">',
    part.modelName ? '<p class="part-meta">Model: ' + escapeHtml(part.modelName) + '</p>' : '',
    part.prompt ? renderSubagentSection('Prompt', part.prompt) : '',
    Array.isArray(part.children) && part.children.length > 0
      ? '<div class="nested-parts subagent-children">' + part.children.map(renderResponsePart).join('') + '</div>'
      : '<p class="muted-copy">No nested subagent activity was serialized.</p>',
    part.result ? renderSubagentSection('Result', part.result) : '',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderSubagentSection(title, text) {
  return [
    '<details class="subagent-section">',
    '<summary>' + escapeHtml(title) + '</summary>',
    '<div class="markdown-content">' + renderMarkdownToHtml(text) + '</div>',
    '</details>'
  ].join('');
}

function renderToolPart(part) {
  return [
    '<details class="response-part tool-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Tool</span>',
    '<span class="part-title">' + escapeHtml(part.title) + '</span>',
    '<span class="status-badge status-' + escapeHtml(part.status) + '">' + escapeHtml(part.status) + '</span>',
    '</summary>',
    '<div class="part-body">',
    part.toolId ? '<p class="part-meta">Tool ID: ' + escapeHtml(part.toolId) + '</p>' : '',
    renderToolDetail(part.detail),
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderToolDetail(detail) {
  if (!detail) {
    return '<p class="muted-copy">No additional tool details were serialized.</p>';
  }

  switch (detail.kind) {
    case 'terminal':
      return [
        detail.command ? '<div class="terminal-command">' + escapeHtml(detail.command) + '</div>' : '',
        detail.cwd ? '<p class="part-meta">cwd: ' + escapeHtml(detail.cwd) + '</p>' : '',
        typeof detail.exitCode === 'number' ? '<p class="part-meta">exit code: ' + escapeHtml(String(detail.exitCode)) + '</p>' : '',
        typeof detail.durationMs === 'number' ? '<p class="part-meta">duration: ' + escapeHtml(String(detail.durationMs)) + ' ms</p>' : '',
        detail.output ? '<pre class="raw-json terminal-output">' + escapeHtml(detail.output) + '</pre>' : ''
      ].join('');
    case 'todoList':
      return '<ul class="detail-list">' + detail.items.map(function (item) {
        return '<li><span>' + escapeHtml(item.title) + '</span><span class="status-badge status-' + escapeHtml(item.status) + '">' + escapeHtml(item.status) + '</span></li>';
      }).join('') + '</ul>';
    case 'subagent':
      return [
        detail.agentName ? '<p class="part-meta">Agent: ' + escapeHtml(detail.agentName) + '</p>' : '',
        detail.modelName ? '<p class="part-meta">Model: ' + escapeHtml(detail.modelName) + '</p>' : '',
        detail.description ? '<div class="markdown-content">' + renderMarkdownToHtml(detail.description) + '</div>' : '',
        detail.prompt ? '<details class="raw-block"><summary>Prompt</summary><pre class="raw-json">' + escapeHtml(detail.prompt) + '</pre></details>' : '',
        detail.result ? '<details class="raw-block"><summary>Result</summary><pre class="raw-json">' + escapeHtml(detail.result) + '</pre></details>' : ''
      ].join('');
    case 'input':
      return [
        detail.rawInput ? '<details class="raw-block" open><summary>Input</summary><pre class="raw-json">' + escapeHtml(detail.rawInput) + '</pre></details>' : '',
        detail.mcpAppData ? '<details class="raw-block"><summary>MCP App Data</summary><pre class="raw-json">' + escapeHtml(detail.mcpAppData) + '</pre></details>' : ''
      ].join('');
    case 'io':
      return [
        detail.input ? '<details class="raw-block" open><summary>Input</summary><pre class="raw-json">' + escapeHtml(detail.input) + '</pre></details>' : '',
        detail.output ? '<details class="raw-block" open><summary>Output</summary><pre class="raw-json">' + escapeHtml(detail.output) + '</pre></details>' : ''
      ].join('');
    case 'uris':
      return '<ul class="detail-list monospace-list">' + detail.items.map(function (item) {
        return '<li>' + escapeHtml(item) + '</li>';
      }).join('') + '</ul>';
    case 'text':
      return '<div class="markdown-content">' + renderMarkdownToHtml(detail.text) + '</div>';
    case 'unknown':
      return '<pre class="raw-json">' + escapeHtml(detail.text) + '</pre>';
    default:
      return '';
  }
}

function renderEditPart(part) {
  return [
    '<details class="response-part edit-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Edit</span>',
    '<span class="part-title">' + escapeHtml(part.summary) + '</span>',
    '</summary>',
    '<div class="part-body">',
    part.uri ? '<p class="part-meta">Target: ' + escapeHtml(part.uri) + '</p>' : '',
    Array.isArray(part.edits) && part.edits.length > 0 ? '<div class="edit-list">' + part.edits.map(function (edit) {
      return '<div class="edit-entry"><p class="part-meta">' + escapeHtml(edit.rangeLabel) + '</p><pre class="raw-json">' + escapeHtml(edit.text) + '</pre></div>';
    }).join('') + '</div>' : '<p class="muted-copy">No serialized text edit details were available.</p>',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderProgressTaskPart(part) {
  return [
    '<details class="response-part progress-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Task</span>',
    '<span class="part-title">' + escapeHtml(part.title) + '</span>',
    '</summary>',
    '<div class="part-body">',
    '<ul class="detail-list">' + part.entries.map(function (entry) {
      return '<li>' + escapeHtml(entry) + '</li>';
    }).join('') + '</ul>',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderConfirmationPart(part) {
  return [
    '<section class="response-part card-like">',
    '<p class="part-kind">Confirmation</p>',
    '<h3>' + escapeHtml(part.title) + '</h3>',
    part.message ? '<div class="markdown-content">' + renderMarkdownToHtml(part.message) + '</div>' : '',
    Array.isArray(part.buttons) && part.buttons.length > 0 ? '<div class="button-row">' + part.buttons.map(function (button) {
      return '<button type="button" class="secondary ghost-button" disabled>' + escapeHtml(button) + '</button>';
    }).join('') + '</div>' : '',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</section>'
  ].join('');
}

function renderElicitationPart(part) {
  return [
    '<section class="response-part card-like">',
    '<div class="part-header-line">',
    '<p class="part-kind">Input Request</p>',
    part.state ? '<span class="status-badge status-' + escapeHtml(part.state) + '">' + escapeHtml(part.state) + '</span>' : '',
    '</div>',
    '<h3>' + escapeHtml(part.title) + '</h3>',
    part.message ? '<div class="markdown-content">' + renderMarkdownToHtml(part.message) + '</div>' : '',
    part.acceptedResult ? '<details class="raw-block"><summary>Accepted Result</summary><pre class="raw-json">' + escapeHtml(part.acceptedResult) + '</pre></details>' : '',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</section>'
  ].join('');
}

function renderQuestionCarouselPart(part) {
  return [
    '<details class="response-part question-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Questions</span>',
    '<span class="part-title">' + escapeHtml(String(part.questions.length)) + ' item(s)</span>',
    '</summary>',
    '<div class="part-body">',
    part.questions.map(function (question) {
      return [
        '<div class="question-card">',
        '<p class="part-meta">' + escapeHtml(question.type) + '</p>',
        '<h3>' + escapeHtml(question.title) + '</h3>',
        question.message ? '<p class="message-body">' + escapeHtml(question.message) + '</p>' : '',
        Array.isArray(question.options) && question.options.length > 0 ? '<ul class="detail-list">' + question.options.map(function (option) {
          return '<li>' + escapeHtml(option) + '</li>';
        }).join('') + '</ul>' : '',
        question.answer !== undefined ? '<p class="part-meta">Answer: ' + escapeHtml(Array.isArray(question.answer) ? question.answer.join(', ') : question.answer) + '</p>' : '',
        '</div>'
      ].join('');
    }).join(''),
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderReferencesPart(part) {
  const open = part.items.length <= 3 ? ' open' : '';
  return [
    '<details class="response-part references-part"' + open + '>',
    '<summary class="part-summary">',
    '<span class="part-kind">' + escapeHtml(part.title) + '</span>',
    '<span class="part-title">' + escapeHtml(String(part.items.length)) + ' reference(s)</span>',
    '</summary>',
    '<div class="part-body">',
    renderReferenceList(part.items),
    '</div>',
    '</details>'
  ].join('');
}

function renderCodeCitationsPart(part) {
  return [
    '<details class="response-part references-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Code Citations</span>',
    '<span class="part-title">' + escapeHtml(String(part.items.length)) + ' citation(s)</span>',
    '</summary>',
    '<div class="part-body">',
    renderReferenceList(part.items),
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</div>',
    '</details>'
  ].join('');
}

function renderReferenceList(items) {
  return '<ul class="detail-list monospace-list">' + items.map(function (item) {
    const detail = item.detail ? '<span class="part-meta">' + escapeHtml(item.detail) + '</span>' : '';
    return '<li><span>' + escapeHtml(item.label) + '</span>' + detail + '</li>';
  }).join('') + '</ul>';
}

function renderErrorPart(part) {
  return [
    '<section class="response-part card-like error-card">',
    '<div class="part-header-line">',
    '<p class="part-kind">Error</p>',
    '<span class="status-badge status-denied">' + escapeHtml(part.title) + '</span>',
    '</div>',
    '<div class="markdown-content">' + renderMarkdownToHtml(part.message) + '</div>',
    Array.isArray(part.buttons) && part.buttons.length > 0 ? '<div class="button-row">' + part.buttons.map(function (button) {
      return '<button type="button" class="secondary ghost-button" disabled>' + escapeHtml(button) + '</button>';
    }).join('') + '</div>' : '',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</section>'
  ].join('');
}

function renderNoticePart(part) {
  return [
    '<section class="response-part card-like ' + (part.tone === 'warning' ? 'warning-card' : 'info-card') + '">',
    '<p class="part-kind">' + escapeHtml(part.title || (part.tone === 'warning' ? 'Warning' : 'Info')) + '</p>',
    '<div class="markdown-content">' + renderMarkdownToHtml(part.text) + '</div>',
    part.rawText ? renderRawBlock(part.rawText) : '',
    '</section>'
  ].join('');
}

function renderUnknownPart(part) {
  return [
    '<details class="response-part unknown-part">',
    '<summary class="part-summary">',
    '<span class="part-kind">Unknown</span>',
    '<span class="part-title">' + escapeHtml(part.label) + '</span>',
    '</summary>',
    '<div class="part-body">',
    renderRawBlock(part.rawText),
    '</div>',
    '</details>'
  ].join('');
}

function renderRawBlock(rawText) {
  return [
    '<details class="raw-block">',
    '<summary>Raw JSON</summary>',
    '<pre class="raw-json">' + escapeHtml(rawText) + '</pre>',
    '</details>'
  ].join('');
}

function handleDetailLinkClick(event) {
  const target = event.target instanceof Element ? event.target.closest('a[data-href]') : null;
  if (!target) {
    return;
  }

  event.preventDefault();
}

function metric(label, value) {
  return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
}

function formatDate(timestamp) {
  if (typeof timestamp !== 'number') {
    return 'Unknown';
  }

  return new Date(timestamp).toLocaleString();
}

function persistState() {
  vscode.setState({
    expandedWorkspaces: state.expandedWorkspaces,
    selectedSessionPath: state.selectedSessionPath,
    showEmptySessions: state.showEmptySessions
  });
}

function installWebviewErrorForwarding() {
  window.addEventListener('error', function (event) {
    postClientLog('error', 'Unhandled webview error.', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack || event.error.message : undefined
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    postClientLog('error', 'Unhandled webview promise rejection.', {
      reason: serializeLogDetails(event.reason)
    });
  });
}

function postClientLog(level, message, details) {
  vscode.postMessage({
    type: 'clientLog',
    value: {
      level: level,
      source: viewMode,
      message: message,
      details: serializeLogDetails(details)
    }
  });
}

function serializeLogDetails(details) {
  if (details === undefined || details === null) {
    return undefined;
  }

  if (details instanceof Error) {
    return details.stack || details.message;
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function ensureDetailRendererRuntime() {
  if (!detailRendererRuntime) {
    detailRendererRuntime = Promise.allSettled([
      import('../node_modules/marked/lib/marked.esm.js'),
      import('../node_modules/dompurify/dist/purify.es.mjs'),
      import('../node_modules/highlight.js/es/common.js')
    ]).then(function (results) {
      const runtime = normalizeDetailRendererDependencies(results);
      markedLibrary = runtime.markedLibrary;
      domPurifyLibrary = runtime.domPurifyLibrary;
      highlightLibrary = runtime.highlightLibrary;

      runtime.warnings.forEach(function (warning) {
        postClientLog(warning.level, warning.message, warning.reason);
      });
    });
  }

  return detailRendererRuntime;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
