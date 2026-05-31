const assert = require('node:assert/strict');
const test = require('node:test');

const { mapChatSessionDocument } = require('../out/chatDocumentMapper.js');

const summary = {
  id: 'session-1',
  title: 'Session Title',
  workspaceHash: 'workspace-hash',
  workspaceName: 'Workspace',
  workspaceFolder: '/workspace',
  sourcePath: '/workspace/session.jsonl',
  createdAt: 100,
  updatedAt: 200
};

test('mapChatSessionDocument normalizes references, attachments, thinking grouping, and inline references', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-1',
    customTitle: 'Normalized Session',
    requests: [
      {
        requestId: 'request-1',
        timestamp: 123,
        message: { text: 'Inspect the current implementation' },
        variableData: {
          variables: [
            { kind: 'workspace', label: 'skip workspace' },
            { kind: 'promptFile', name: 'hidden.prompt.md', automaticallyAdded: true },
            { kind: 'file', name: 'src/main.ts' }
          ]
        },
        contentReferences: [
          {
            kind: 'reference',
            reference: {
              fsPath: '/workspace/README.md',
              path: '/workspace/README.md',
              scheme: 'file'
            }
          }
        ],
        response: [
          {
            kind: 'thinking',
            value: '**Reviewing implementation**\nNeed to inspect the current flow.'
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_readFile',
            isComplete: true,
            pastTenseMessage: { value: 'Read the relevant file' }
          },
          {
            kind: 'thinking',
            value: '',
            metadata: { vscodeReasoningDone: true }
          },
          { value: 'See ' },
          {
            kind: 'inlineReference',
            name: 'README.md',
            inlineReference: {
              fsPath: '/workspace/README.md',
              path: '/workspace/README.md',
              scheme: 'file'
            }
          },
          { value: ' for details.' },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_applyPatch',
            isComplete: true,
            presentation: 'hidden'
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/workspace/src/main.ts', path: '/workspace/src/main.ts', scheme: 'file' },
            edits: [
              [
                {
                  text: 'const updated = true;',
                  range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 10 }
                }
              ]
            ],
            done: true
          }
        ]
      }
    ]
  });

  assert.equal(document.turns.length, 1);
  assert.deepEqual(document.turns[0].attachments, [
    { kind: 'file', label: 'src/main.ts', detail: undefined }
  ]);

  const responseParts = document.turns[0].responseParts;
  assert.equal(responseParts.length, 4);
  assert.equal(responseParts[0].type, 'references');
  assert.equal(responseParts[1].type, 'thinking');
  assert.equal(responseParts[1].children.length, 1);
  assert.equal(responseParts[1].children[0].type, 'tool');
  assert.equal(responseParts[2].type, 'markdown');
  assert.match(responseParts[2].text, /README\.md/);
  assert.equal(responseParts[3].type, 'edit');
});

test('mapChatSessionDocument preserves codeblock annotations on markdown parts', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-2',
    requests: [
      {
        requestId: 'request-2',
        message: { text: 'Show the patch' },
        response: [
          { value: '```js\nconsole.log(1);\n```' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/workspace/src/example.js', path: '/workspace/src/example.js', scheme: 'file' },
            isEdit: true
          }
        ]
      }
    ]
  });

  const markdownPart = document.turns[0].responseParts[0];
  assert.equal(markdownPart.type, 'markdown');
  assert.deepEqual(markdownPart.codeBlocks, [
    { label: '/workspace/src/example.js', isEdit: true }
  ]);
});

test('mapChatSessionDocument extracts terminal tool details and synthetic error/footer parts', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-3',
    requests: [
      {
        requestId: 'request-3',
        message: { text: 'Run the command' },
        result: {
          errorDetails: {
            code: 'failed',
            message: 'The tool failed to execute.',
            confirmationButtons: [{ label: 'Retry' }]
          },
          details: 'GPT-5.4 • 1x'
        },
        response: [
          {
            kind: 'toolInvocationSerialized',
            toolId: 'run_in_terminal',
            isComplete: true,
            toolSpecificData: {
              kind: 'terminal',
              commandLine: { original: 'npm run compile' },
              cwd: { fsPath: '/workspace', path: '/workspace', scheme: 'file' },
              language: 'bash',
              terminalCommandState: { exitCode: 1, output: 'compile failed', durationMs: 1200 }
            },
            pastTenseMessage: { value: 'Ran npm run compile' }
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  assert.equal(responseParts[0].type, 'tool');
  assert.equal(responseParts[0].detail.kind, 'terminal');
  assert.equal(responseParts[0].detail.command, 'npm run compile');
  assert.equal(responseParts[1].type, 'error');
  assert.equal(responseParts[1].buttons[0], 'Retry');
  assert.equal(responseParts[2].type, 'footer');
  assert.equal(responseParts[2].text, 'GPT-5.4 • 1x');
});

test('mapChatSessionDocument keeps whitespace-only text fragments between inline references', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-4',
    requests: [
      {
        requestId: 'request-4',
        message: { text: 'Show validation files' },
        response: [
          {
            kind: 'inlineReference',
            inlineReference: {
              path: '/workspace/unit-tests/test_super_emc.py',
              scheme: 'file'
            }
          },
          {
            value: ' ',
            supportThemeIcons: false,
            supportHtml: false,
            supportAlertSyntax: false,
            baseUri: {
              path: '/workspace',
              scheme: 'file'
            },
            uris: {}
          },
          {
            kind: 'inlineReference',
            inlineReference: {
              path: '/workspace/unit-tests/test_explorer_param_expansion.py',
              scheme: 'file'
            }
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  assert.equal(responseParts.length, 1);
  assert.equal(responseParts[0].type, 'markdown');
  assert.equal(
    responseParts[0].text,
    'file:/workspace/unit-tests/test_super_emc.py file:/workspace/unit-tests/test_explorer_param_expansion.py'
  );
});