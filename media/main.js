(function () {
  const vscode = acquireVsCodeApi();
  const persistedState = vscode.getState() || {};
  const state = {
    expandedWorkspaces: {},
    selectedSessionPath: typeof persistedState.selectedSessionPath === 'string' ? persistedState.selectedSessionPath : undefined
  };
  const viewMode = document.body.getAttribute('data-view') || 'sessions';

  if (viewMode === 'session-detail') {
    initSessionDetailView();
    return;
  }

  initSessionsView();

  function initSessionsView() {
    let currentScan;
    const workspaceSessions = new Map();
    const workspaceWarnings = new Map();
    const workspaceErrors = new Map();
    const loadingWorkspaces = new Set();

    const refreshButton = document.getElementById('refreshButton');
    const settingsButton = document.getElementById('settingsButton');
    const summary = document.getElementById('summary');
    const warnings = document.getElementById('warnings');
    const sessions = document.getElementById('sessions');

    if (!refreshButton || !settingsButton || !summary || !warnings || !sessions) {
      return;
    }

    refreshButton.addEventListener('click', function () {
      resetWorkspaceState();
      renderLoading('Refreshing sessions...');
      vscode.postMessage({ type: 'refresh' });
    });

    settingsButton.addEventListener('click', function () {
      vscode.postMessage({ type: 'openSettings' });
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
        '<div class="metrics">',
        metric('Source', scan.loadedFromCache ? 'Cache' : 'Live'),
        metric('Roots', String(scan.rootsScanned.length)),
        metric('Workspaces', String(scan.workspaceCount)),
        metric('Sessions', String(scan.sessionCount)),
        metric('Scanned', formatDate(scan.scannedAt)),
        '</div>',
        '<div class="card roots"><strong>Roots</strong><ul>' + scan.rootsScanned.map(function (root) {
          return '<li>' + escapeHtml(root) + '</li>';
        }).join('') + '</ul></div>'
      ].join('');

      if (Array.isArray(scan.warnings) && scan.warnings.length > 0) {
        warnings.innerHTML = '<div class="card warning"><strong>Warnings</strong><ul>' + scan.warnings.map(function (warning) {
          return '<li><span>' + escapeHtml(warning.message) + '</span><code>' + escapeHtml(warning.location) + '</code></li>';
        }).join('') + '</ul></div>';
      } else {
        warnings.innerHTML = '';
      }

      if (!Array.isArray(scan.workspaces) || scan.workspaces.length === 0) {
        sessions.innerHTML = '<div class="card empty">No workspaces with chatSessions were found in the configured roots.</div>';
        return;
      }

      sessions.innerHTML = '<div class="workspace-groups">' + scan.workspaces.map(function (workspace) {
        const workspaceKey = workspace.chatSessionsDir;
        const isExpanded = Boolean(state.expandedWorkspaces[workspaceKey]);
        const loadedSessions = workspaceSessions.get(workspaceKey);
        const loadWarnings = workspaceWarnings.get(workspaceKey) || [];
        const loadError = workspaceErrors.get(workspaceKey);
        const isLoading = loadingWorkspaces.has(workspaceKey);

        return [
          '<details class="workspace-group" data-workspace-key="' + escapeHtml(workspaceKey) + '"' + (isExpanded ? ' open' : '') + '>',
          '<summary class="workspace-header">',
          '<div>',
          '<p class="workspace-label">Workspace</p>',
          '<h2>' + escapeHtml(workspace.workspaceName) + '</h2>',
          workspace.workspaceFolder ? '<p class="path">' + escapeHtml(workspace.workspaceFolder) + '</p>' : '',
          '</div>',
          '<span class="workspace-chevron" aria-hidden="true">▾</span>',
          '<div class="workspace-stats">',
          '<strong>' + escapeHtml(String(workspace.sessionCount)) + '</strong>',
          '<span>Load on expand</span>',
          '</div>',
          '</summary>',
          '<div class="list">',
          renderWorkspaceBody(workspace, loadedSessions, loadWarnings, loadError, isLoading),
          '</div>',
          '</details>'
        ].join('');
      }).join('') + '</div>';

      attachWorkspaceToggleListeners(sessions, requestWorkspaceSessions);
      attachSessionSelectionListeners(sessions, findSessionSummaryBySourcePath);
    }

    function renderWorkspaceBody(workspace, loadedSessions, loadWarnings, loadError, isLoading) {
      if (isLoading) {
        return '<div class="card">Loading session summaries...</div>';
      }

      if (loadError) {
        return '<div class="card error">' + escapeHtml(loadError) + '</div>';
      }

      if (!Array.isArray(loadedSessions)) {
        return '<div class="card">Expand this workspace to load its session list.</div>';
      }

      const sessionListMarkup = loadedSessions.length === 0
        ? '<div class="card empty">No readable session files were found in this workspace.</div>'
        : loadedSessions.map(function (session) {
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

  function initSessionDetailView() {
    const detailSummary = document.getElementById('detailSummary');
    const detailTurns = document.getElementById('detailTurns');

    if (!detailSummary || !detailTurns) {
      return;
    }

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

    function renderLoadingState(viewState) {
      detailSummary.innerHTML = [
        '<div class="card">',
        '<p class="workspace-label">Status</p>',
        '<h2>' + escapeHtml(viewState.title || 'Loading') + '</h2>',
        '<p class="subtitle">' + escapeHtml(viewState.message || 'Loading...') + '</p>',
        '</div>'
      ].join('');
      detailTurns.innerHTML = '';
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
    }

    function renderDocument(documentValue) {
      const responderName = documentValue.responderUsername || 'Assistant';
      detailSummary.innerHTML = [
        '<div class="metrics detail-metrics">',
        metric('Workspace', documentValue.workspaceName || 'Unknown'),
        metric('Turns', String(Array.isArray(documentValue.turns) ? documentValue.turns.length : 0)),
        metric('Created', formatDate(documentValue.createdAt)),
        metric('Updated', formatDate(documentValue.updatedAt)),
        metric('Responder', responderName),
        '</div>',
        '<div class="card detail-meta-card">',
        '<p class="workspace-label">Session</p>',
        '<h2>' + escapeHtml(documentValue.title || 'Untitled session') + '</h2>',
        documentValue.workspaceFolder ? '<p class="path">Workspace: ' + escapeHtml(documentValue.workspaceFolder) + '</p>' : '',
        '<p class="path">Source: ' + escapeHtml(documentValue.sourcePath || 'Unknown') + '</p>',
        '</div>'
      ].join('');

      if (!Array.isArray(documentValue.turns) || documentValue.turns.length === 0) {
        detailTurns.innerHTML = '<div class="card empty">This session does not have any stored requests yet.</div>';
        return;
      }

      detailTurns.innerHTML = '<div class="turn-list">' + documentValue.turns.map(function (turn, index) {
        return renderTurn(turn, index, responderName);
      }).join('') + '</div>';
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

  function renderTurn(turn, index, responderName) {
    return [
      '<section class="turn">',
      '<div class="turn-header">',
      '<span class="turn-label">Turn ' + escapeHtml(String(index + 1)) + '</span>',
      '<span class="meta">' + escapeHtml(formatDate(turn.timestamp)) + '</span>',
      '</div>',
      '<article class="message message-user">',
      '<p class="message-role">User</p>',
      '<div class="message-body">' + formatMultilineText(turn.userText) + '</div>',
      '</article>',
      renderResponseParts(turn.responseParts, responderName),
      '</section>'
    ].join('');
  }

  function renderResponseParts(parts, responderName) {
    if (!Array.isArray(parts) || parts.length === 0) {
      return [
        '<article class="message message-assistant">',
        '<p class="message-role">' + escapeHtml(responderName) + '</p>',
        '<div class="message-body muted-copy">No assistant response content was captured for this turn.</div>',
        '</article>'
      ].join('');
    }

    return parts.map(function (part) {
      if (part.type === 'markdown') {
        return [
          '<article class="message message-assistant">',
          '<p class="message-role">' + escapeHtml(responderName) + '</p>',
          '<div class="message-body">' + formatMultilineText(part.text) + '</div>',
          '</article>'
        ].join('');
      }

      if (part.type === 'thinking') {
        return renderDetailCard('Thinking', part.title + (part.done ? ' completed' : ''), formatMultilineText(part.text), part.rawText);
      }

      if (part.type === 'tool') {
        const toolMeta = part.toolId ? '<p class="meta">Tool: ' + escapeHtml(part.toolId) + '</p>' : '';
        return renderDetailCard('Tool', part.title + ' [' + part.status + ']', toolMeta, part.rawText);
      }

      if (part.type === 'edit') {
        return renderDetailCard('Edit', part.summary, part.uri ? '<p class="meta">URI: ' + escapeHtml(part.uri) + '</p>' : '', part.rawText);
      }

      return renderDetailCard('Raw', part.label, '', part.rawText);
    }).join('');
  }

  function renderDetailCard(kind, summaryText, bodyHtml, rawText) {
    return [
      '<details class="detail-card" open>',
      '<summary>',
      '<span class="message-role">' + escapeHtml(kind) + '</span>',
      '<span class="detail-summary-text">' + escapeHtml(summaryText) + '</span>',
      '</summary>',
      '<div class="detail-content">',
      bodyHtml ? '<div class="message-body">' + bodyHtml + '</div>' : '',
      rawText ? renderRawBlock(rawText) : '',
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

  function metric(label, value) {
    return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function formatDate(timestamp) {
    if (typeof timestamp !== 'number') {
      return 'Unknown';
    }

    return new Date(timestamp).toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMultilineText(value) {
    return escapeHtml(value == null ? '' : value).replace(/\n/g, '<br />');
  }

  function persistState() {
    vscode.setState({ selectedSessionPath: state.selectedSessionPath });
  }
}());