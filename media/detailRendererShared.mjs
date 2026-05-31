export function normalizeDetailRendererDependencies(results) {
  const dependencies = [
    { moduleName: 'marked', key: 'markedLibrary', exportName: 'marked', required: true },
    { moduleName: 'dompurify', key: 'domPurifyLibrary', exportName: 'default', required: true },
    { moduleName: 'highlight.js', key: 'highlightLibrary', exportName: 'default', required: false }
  ];

  const runtime = {
    markedLibrary: undefined,
    domPurifyLibrary: undefined,
    highlightLibrary: undefined,
    warnings: []
  };

  dependencies.forEach(function (dependency, index) {
    const result = Array.isArray(results) ? results[index] : undefined;
    const value = resolveDependencyValue(result, dependency.exportName);

    if (value !== undefined) {
      runtime[dependency.key] = value;
      return;
    }

    runtime.warnings.push({
      level: dependency.required ? 'error' : 'warn',
      moduleName: dependency.moduleName,
      message: 'Failed to load detail renderer dependency: ' + dependency.moduleName + '.',
      reason: describeDependencyFailure(result, dependency)
    });
  });

  return runtime;
}

export function renderMarkdownToHtml(markdownText, codeBlocks, runtime) {
  const rendererRuntime = runtime || {};
  const plainTextFormatter = typeof rendererRuntime.formatMultilineText === 'function'
    ? rendererRuntime.formatMultilineText
    : formatMultilineText;

  if (typeof markdownText !== 'string' || !markdownText) {
    return '';
  }

  if (!rendererRuntime.markedLibrary || !rendererRuntime.domPurifyLibrary) {
    return plainTextFormatter(markdownText);
  }

  try {
    const html = typeof rendererRuntime.renderMarkdown === 'function'
      ? rendererRuntime.renderMarkdown(markdownText, Array.isArray(codeBlocks) ? codeBlocks.slice() : [], rendererRuntime)
      : rendererRuntime.markedLibrary.parse(markdownText, {
        gfm: true,
        breaks: true,
        renderer: createMarkedRenderer(Array.isArray(codeBlocks) ? codeBlocks.slice() : [], rendererRuntime)
      });
    const sanitize = typeof rendererRuntime.sanitizeHtml === 'function'
      ? rendererRuntime.sanitizeHtml
      : sanitizeHtml;
    return sanitize(String(html), rendererRuntime);
  } catch {
    return plainTextFormatter(markdownText);
  }
}

export function renderCodeBlock(text, language, annotation, runtime) {
  const escape = typeof runtime?.escapeHtml === 'function' ? runtime.escapeHtml : escapeHtml;
  const normalizedLanguage = typeof language === 'string' ? language.trim() : '';
  const highlighted = highlightCode(text, normalizedLanguage, runtime);
  const headerParts = [];

  if (normalizedLanguage) {
    headerParts.push('<span class="code-lang">' + escape(normalizedLanguage) + '</span>');
  }

  if (annotation && annotation.label) {
    headerParts.push('<span class="code-file">' + escape(annotation.label) + '</span>');
  }

  if (annotation && annotation.isEdit) {
    headerParts.push('<span class="status-badge status-completed">edit</span>');
  }

  return [
    '<div class="code-block">',
    headerParts.length > 0 ? '<div class="code-block-header">' + headerParts.join('') + '</div>' : '',
    '<pre><code class="hljs' + (normalizedLanguage ? ' language-' + escape(normalizedLanguage) : '') + '">' + highlighted + '</code></pre>',
    '</div>'
  ].join('');
}

export function highlightCode(text, language, runtime) {
  const escape = typeof runtime?.escapeHtml === 'function' ? runtime.escapeHtml : escapeHtml;
  const source = typeof text === 'string' ? text : '';
  const highlightLibrary = runtime?.highlightLibrary;

  if (!highlightLibrary) {
    return escape(source);
  }

  try {
    if (language && highlightLibrary.getLanguage(language)) {
      return highlightLibrary.highlight(source, { language: language }).value;
    }

    return highlightLibrary.highlightAuto(source).value;
  } catch {
    return escape(source);
  }
}

export function sanitizeHtml(html, runtime) {
  if (!runtime?.domPurifyLibrary) {
    return html;
  }

  const containerFactory = typeof runtime.createContainer === 'function'
    ? runtime.createContainer
    : createDefaultContainer;
  const sanitized = runtime.domPurifyLibrary.sanitize(html, {
    USE_PROFILES: { html: true }
  });
  const container = containerFactory();

  container.innerHTML = sanitized;

  Array.from(container.querySelectorAll('a')).forEach(function (anchor) {
    const href = anchor.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      return;
    }

    anchor.setAttribute('data-href', href);
    anchor.setAttribute('href', '#');
    anchor.classList.add('link-disabled');
  });

  return container.innerHTML;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMultilineText(value) {
  return escapeHtml(value == null ? '' : value).replace(/\n/g, '<br />');
}

function createMarkedRenderer(codeBlocks, runtime) {
  return {
    code(token) {
      const text = typeof token === 'string' ? token : (token && typeof token.text === 'string' ? token.text : '');
      const lang = typeof token === 'object' && token && typeof token.lang === 'string' ? token.lang : '';
      const annotation = codeBlocks.shift();
      return renderCodeBlock(text, lang, annotation, runtime);
    }
  };
}

function resolveDependencyValue(result, exportName) {
  if (!result || result.status !== 'fulfilled' || typeof result.value !== 'object' || result.value === null) {
    return undefined;
  }

  const moduleValue = result.value;
  return moduleValue[exportName];
}

function describeDependencyFailure(result, dependency) {
  if (!result) {
    return 'Module load result was not available.';
  }

  if (result.status === 'fulfilled') {
    return 'Module "' + dependency.moduleName + '" loaded without the expected export.';
  }

  return stringifyError(result.reason);
}

function createDefaultContainer() {
  if (typeof document === 'undefined') {
    throw new Error('A DOM container factory is required when sanitizeHtml runs outside the webview.');
  }

  return document.createElement('div');
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}