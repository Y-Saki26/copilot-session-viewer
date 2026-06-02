import assert from 'node:assert/strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
import { test } from 'vitest';

let rendererModulePromise: Promise<typeof import('../media/detailRendererShared.mjs')> | undefined;

interface RendererDependencyWarning {
  level: string;
  message: string;
  reason: string;
}

interface RendererDependencyRuntime {
  markedLibrary?: { parse?: unknown };
  domPurifyLibrary?: unknown;
  highlightLibrary?: unknown;
  warnings: RendererDependencyWarning[];
}

function loadRendererModule() {
  if (!rendererModulePromise) {
    const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'media', 'detailRendererShared.mjs')).href;
    rendererModulePromise = import(moduleUrl);
  }

  return rendererModulePromise;
}

test('normalizeDetailRendererDependencies preserves fulfilled modules and reports failures', async () => {
  const { normalizeDetailRendererDependencies } = await loadRendererModule();
  const runtime = normalizeDetailRendererDependencies([
    { status: 'fulfilled', value: { marked: { parse() {} } } },
    { status: 'rejected', reason: new Error('dompurify missing') },
    { status: 'rejected', reason: 'highlight unavailable' }
  ]) as RendererDependencyRuntime;

  assert.equal(typeof runtime.markedLibrary?.parse, 'function');
  assert.equal(runtime.domPurifyLibrary, undefined);
  assert.equal(runtime.highlightLibrary, undefined);
  assert.equal(runtime.warnings.length, 2);
  assert.equal(runtime.warnings[0].level, 'error');
  assert.match(runtime.warnings[0].message, /dompurify/);
  assert.match(runtime.warnings[0].reason, /dompurify missing/);
  assert.equal(runtime.warnings[1].level, 'warn');
  assert.match(runtime.warnings[1].message, /highlight\.js/);
});

test('renderMarkdownToHtml falls back to escaped plain text when runtime is incomplete', async () => {
  const { renderMarkdownToHtml } = await loadRendererModule();
  const html = renderMarkdownToHtml('line 1\n<script>alert(1)</script>', [], {
    markedLibrary: undefined,
    domPurifyLibrary: undefined
  });

  assert.equal(html, 'line 1<br />&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderMarkdownToHtml annotates code blocks produced by the markdown renderer', async () => {
  const { renderMarkdownToHtml } = await loadRendererModule();
  const html = renderMarkdownToHtml('```ts\nconst value = 1;\n```', [{ label: '/workspace/src/app.ts', isEdit: true }], {
    markedLibrary: {
      parse(markdown: string, options: { renderer: { code(input: { text: string; lang: string }): string } }) {
        return options.renderer.code({ text: 'const value = 1 < 2;', lang: 'ts' });
      }
    },
    domPurifyLibrary: {
      sanitize(value: string) {
        return value;
      }
    },
    createContainer() {
      return {
        _html: '',
        set innerHTML(value) {
          this._html = value;
        },
        get innerHTML() {
          return this._html;
        },
        querySelectorAll() {
          return [];
        }
      };
    }
  });

  assert.match(html, /language-ts/);
  assert.match(html, /\/workspace\/src\/app\.ts/);
  assert.match(html, /status-completed/);
  assert.match(html, /const value = 1 &lt; 2;/);
});

test('highlightCode uses the configured highlight library when the language is known', async () => {
  const { highlightCode } = await loadRendererModule();
  const html = highlightCode('const value = 1;', 'ts', {
    highlightLibrary: {
      getLanguage(language: string) {
        return language === 'ts';
      },
      highlight(source: string, options: { language: string }) {
        return { value: '<mark>' + source + ':' + options.language + '</mark>' };
      },
      highlightAuto() {
        throw new Error('highlightAuto should not be used for known languages.');
      }
    }
  });

  assert.equal(html, '<mark>const value = 1;:ts</mark>');
});
