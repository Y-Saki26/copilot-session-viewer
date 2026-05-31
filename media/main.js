(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { collapsedWorkspaces: {}, selectedSessionPath: undefined };
  const viewMode = document.body.getAttribute('data-view') || 'sessions';

  if (!state.collapsedWorkspaces || typeof state.collapsedWorkspaces !== 'object') {
    state.collapsedWorkspaces = {};
  }

  if (viewMode === 'session-detail') {
    initSessionDetailView();
    return;
  }

  initSessionsView();

  function initSessionsView() {
    const refreshButton = document.getElementById('refreshButton');
    const settingsButton = document.getElementById('settingsButton');
    const summary = document.getElementById('summary');
    const warnings = document.getElementById('warnings');
    const sessions = document.getElementById('sessions');

    if (!refreshButton || !settingsButton || !summary || !warnings || !sessions) {
      return;
    }

    refreshButton.addEventListener('click', function () {
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
      const groupedSessions = groupSessionsByWorkspace(scan.sessions);

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

      if (!Array.isArray(scan.sessions) || scan.sessions.length === 0) {
        sessions.innerHTML = '<div class="card empty">No session files were found in the configured roots.</div>';
        return;
      }

      sessions.innerHTML = '<div class="workspace-groups">' + groupedSessions.map(function (group) {
        const isCollapsed = Boolean(state.collapsedWorkspaces[group.workspaceKey]);
        return [
          '<details class="workspace-group" data-workspace-key="' + escapeHtml(group.workspaceKey) + '"' + (isCollapsed ? '' : ' open') + '>',
          '<summary class="workspace-header">',
          '<div>',
          '<p class="workspace-label">Workspace</p>',
          '<h2>' + escapeHtml(group.workspaceName) + '</h2>',
          group.workspaceFolder ? '<p class="path">' + escapeHtml(group.workspaceFolder) + '</p>' : '',
          '</div>',
          '<span class="workspace-chevron" aria-hidden="true">▾</span>',
          '<div class="workspace-stats">',
          '<strong>' + escapeHtml(String(group.sessions.length)) + '</strong>',
          '<span>Latest ' + escapeHtml(formatDate(group.latestUpdatedAt)) + '</span>',
          '</div>',
          '</summary>',
          '<div class="list">',
          group.sessions.map(function (session) {
            const selectedClass = session.sourcePath === state.selectedSessionPath ? ' selected' : '';
            return [
              '<button type="button" class="session-card' + selectedClass + '" data-source-path="' + escapeHtml(session.sourcePath) + '">',
              '<span class="session-title">' + escapeHtml(session.title) + '</span>',
              '<span class="meta">Updated ' + escapeHtml(formatDate(session.updatedAt)) + '</span>',
              session.createdAt ? '<span class="meta">Created ' + escapeHtml(formatDate(session.createdAt)) + '</span>' : '',
              '<span class="path">Source: ' + escapeHtml(session.sourcePath) + '</span>',
              '</button>'
            ].join('');
          }).join(''),
          '</div>',
          '</details>'
        ].join('');
      }).join('') + '</div>';

      attachWorkspaceToggleListeners(sessions);
      attachSessionSelectionListeners(sessions);
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

  function groupSessionsByWorkspace(sessionList) {
    if (!Array.isArray(sessionList)) {
      return [];
    }

    const groups = new Map();

    sessionList.forEach(function (session) {
      const workspaceKey = session.workspaceHash || session.workspaceName || 'unknown';
      if (!groups.has(workspaceKey)) {
        groups.set(workspaceKey, {
          workspaceKey: workspaceKey,
          workspaceName: session.workspaceName || 'Unknown workspace',
          workspaceFolder: session.workspaceFolder,
          sessions: []
        });
      }

      groups.get(workspaceKey).sessions.push(session);
    });

    return Array.from(groups.values())
      .map(function (group) {
        group.sessions.sort(function (left, right) {
          return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title);
        });
        group.latestUpdatedAt = group.sessions[0] ? group.sessions[0].updatedAt : 0;
        return group;
      })
      .sort(function (left, right) {
        return right.latestUpdatedAt - left.latestUpdatedAt || left.workspaceName.localeCompare(right.workspaceName);
      });
  }

  function attachWorkspaceToggleListeners(container) {
    Array.from(container.querySelectorAll('.workspace-group')).forEach(function (element) {
      element.addEventListener('toggle', function () {
        const workspaceKey = element.getAttribute('data-workspace-key');
        if (!workspaceKey) {
          return;
        }

        state.collapsedWorkspaces[workspaceKey] = !element.open;
        vscode.setState(state);
      });
    });
  }

  function attachSessionSelectionListeners(container) {
    Array.from(container.querySelectorAll('.session-card')).forEach(function (element) {
      element.addEventListener('click', function () {
        const sourcePath = element.getAttribute('data-source-path');
        if (!sourcePath) {
          return;
        }

        state.selectedSessionPath = sourcePath;
        vscode.setState(state);
        updateSelectedSession(sourcePath, container);
        vscode.postMessage({ type: 'selectSession', sourcePath: sourcePath });
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
}());