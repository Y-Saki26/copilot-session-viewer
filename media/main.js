(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { collapsedWorkspaces: {} };
  const refreshButton = document.getElementById('refreshButton');
  const settingsButton = document.getElementById('settingsButton');
  const summary = document.getElementById('summary');
  const warnings = document.getElementById('warnings');
  const sessions = document.getElementById('sessions');

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
          return [
            '<article class="session">',
            '<h3>' + escapeHtml(session.title) + '</h3>',
            '<p class="meta">Updated ' + escapeHtml(formatDate(session.updatedAt)) + '</p>',
            '<p class="path">Source: ' + escapeHtml(session.sourcePath) + '</p>',
            '</article>'
          ].join('');
        }).join(''),
        '</div>',
        '</details>'
      ].join('');
    }).join('') + '</div>';

    attachWorkspaceToggleListeners();
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

  function attachWorkspaceToggleListeners() {
    Array.from(sessions.querySelectorAll('.workspace-group')).forEach(function (element) {
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
}());