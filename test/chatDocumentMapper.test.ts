import assert from 'node:assert/strict';
import { test } from 'vitest';

import { mapChatSessionDocument } from '../src/chatDocumentMapper';
import { SessionSummary, ViewerResponsePart, ViewerToolDetail } from '../src/types';

const summary = {
  id: 'session-1',
  title: 'Session Title',
  isEmpty: false,
  workspaceHash: 'workspace-hash',
  workspaceName: 'Workspace',
  workspaceFolder: '/workspace',
  sourcePath: '/workspace/session.jsonl',
  createdAt: 100,
  updatedAt: 200
} satisfies SessionSummary;

function responsePartAt<T extends ViewerResponsePart['type']>(
  parts: readonly ViewerResponsePart[],
  index: number,
  type: T
): Extract<ViewerResponsePart, { type: T }> {
  const part = parts[index];
  assert.equal(part.type, type);
  return part as Extract<ViewerResponsePart, { type: T }>;
}

function toolDetailOfKind<T extends ViewerToolDetail['kind']>(
  detail: ViewerToolDetail | undefined,
  kind: T
): Extract<ViewerToolDetail, { kind: T }> {
  assert.equal(detail?.kind, kind);
  return detail as Extract<ViewerToolDetail, { kind: T }>;
}

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
  const thinkingPart = responsePartAt(responseParts, 1, 'thinking');
  const markdownPart = responsePartAt(responseParts, 2, 'markdown');
  assert.equal(responseParts.length, 4);
  assert.equal(responseParts[0].type, 'references');
  assert.equal(thinkingPart.children.length, 1);
  assert.equal(thinkingPart.children[0].type, 'tool');
  assert.match(markdownPart.text, /README\.md/);
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

  const markdownPart = responsePartAt(document.turns[0].responseParts, 0, 'markdown');
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
  const terminalDetail = toolDetailOfKind(responsePartAt(responseParts, 0, 'tool').detail, 'terminal');
  const errorPart = responsePartAt(responseParts, 1, 'error');
  assert.equal(terminalDetail.command, 'npm run compile');
  assert.equal(errorPart.buttons?.[0], 'Retry');
  assert.equal(responsePartAt(responseParts, 2, 'footer').text, 'GPT-5.4 • 1x');
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
  const markdownPart = responsePartAt(responseParts, 0, 'markdown');
  assert.equal(responseParts.length, 1);
  assert.equal(
    markdownPart.text,
    'file:/workspace/unit-tests/test_super_emc.py file:/workspace/unit-tests/test_explorer_param_expansion.py'
  );
});

test('mapChatSessionDocument groups subagent children and annotated edit code blocks under the parent dropdown', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-5',
    requests: [
      {
        requestId: 'request-5',
        message: { text: 'Delegate the review' },
        response: [
          {
            kind: 'thinking',
            value: '**Planning delegation**\nUse a focused reviewer.'
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'subagent-root',
            isComplete: true,
            toolSpecificData: {
              kind: 'subagent',
              agentName: 'reviewer',
              description: 'Review the parser',
              prompt: 'Inspect the mapper.',
              result: 'The mapper needs nested grouping.',
              modelName: 'gpt-test'
            }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_readFile',
            toolCallId: 'child-read',
            subAgentInvocationId: 'subagent-root',
            isComplete: true,
            pastTenseMessage: { value: 'Read the mapper' }
          },
          {
            value: '```ts\nconst nested = true;\n```\n<vscode_codeblock_uri isEdit subAgentInvocationId="subagent-root">file:///workspace/src/chatDocumentMapper.ts</vscode_codeblock_uri>'
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_readFile',
            toolCallId: 'outer-read',
            isComplete: true,
            pastTenseMessage: { value: 'Read the outer file' }
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const thinkingPart = responsePartAt(responseParts, 0, 'thinking');
  const subagentPart = responsePartAt(responseParts, 1, 'subagent');
  const childTool = responsePartAt(subagentPart.children, 0, 'tool');
  const childMarkdown = responsePartAt(subagentPart.children, 1, 'markdown');
  const outerTool = responsePartAt(responseParts, 2, 'tool');
  assert.equal(responseParts.length, 3);
  assert.equal(thinkingPart.children.length, 0);
  assert.equal(subagentPart.subAgentInvocationId, 'subagent-root');
  assert.equal(subagentPart.title, 'Reviewer: Review the parser');
  assert.equal(subagentPart.prompt, 'Inspect the mapper.');
  assert.equal(subagentPart.result, 'The mapper needs nested grouping.');
  assert.equal(subagentPart.children.length, 2);
  assert.equal(childTool.toolCallId, 'child-read');
  assert.equal(childMarkdown.text, '```ts\nconst nested = true;\n```\n');
  assert.deepEqual(childMarkdown.codeBlocks, [
    {
      label: 'file:///workspace/src/chatDocumentMapper.ts',
      isEdit: true,
      subAgentInvocationId: 'subagent-root'
    }
  ]);
  assert.equal(outerTool.toolCallId, 'outer-read');
});

test('mapChatSessionDocument separates parallel subagents and folds deep nested tools into the root dropdown', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-6',
    requests: [
      {
        requestId: 'request-6',
        message: { text: 'Run parallel delegates' },
        response: [
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'root-a',
            isComplete: true,
            toolSpecificData: { kind: 'subagent', description: 'Inspect A' }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'root-b',
            isComplete: true,
            toolSpecificData: { kind: 'subagent', description: 'Inspect B' }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'task',
            toolCallId: 'nested-task',
            subAgentInvocationId: 'root-a',
            isComplete: true,
            pastTenseMessage: { value: 'Ran nested task' }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'grep',
            toolCallId: 'deep-grep',
            subAgentInvocationId: 'root-a',
            isComplete: true,
            pastTenseMessage: { value: 'Searched deeply' }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'grep',
            toolCallId: 'grep-b',
            subAgentInvocationId: 'root-b',
            isComplete: true,
            pastTenseMessage: { value: 'Searched B' }
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const firstSubagent = responsePartAt(responseParts, 0, 'subagent');
  const secondSubagent = responsePartAt(responseParts, 1, 'subagent');
  assert.equal(responseParts.length, 2);
  assert.equal(firstSubagent.subAgentInvocationId, 'root-a');
  assert.deepEqual(firstSubagent.children.map((part) => responsePartAt([part], 0, 'tool').toolCallId), ['nested-task', 'deep-grep']);
  assert.equal(secondSubagent.subAgentInvocationId, 'root-b');
  assert.deepEqual(secondSubagent.children.map((part) => responsePartAt([part], 0, 'tool').toolCallId), ['grep-b']);
});

test('mapChatSessionDocument backfills a subagent dropdown when children precede the parent tool', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-7',
    requests: [
      {
        requestId: 'request-7',
        message: { text: 'Restore a compatibility log' },
        response: [
          { value: '```txt\nupdated content\n```' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/workspace/src/late.txt', path: '/workspace/src/late.txt', scheme: 'file' },
            isEdit: true,
            subAgentInvocationId: 'late-parent'
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'grep',
            toolCallId: 'late-child',
            subAgentInvocationId: 'late-parent',
            isComplete: true
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'late-parent',
            isComplete: true,
            toolSpecificData: {
              kind: 'subagent',
              agentName: 'compatibility',
              description: 'Restore old ordering'
            }
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const subagentPart = responsePartAt(responseParts, 0, 'subagent');
  const childMarkdown = responsePartAt(subagentPart.children, 0, 'markdown');
  const childTool = responsePartAt(subagentPart.children, 1, 'tool');
  assert.equal(responseParts.length, 1);
  assert.equal(subagentPart.title, 'Compatibility: Restore old ordering');
  assert.equal(subagentPart.children.length, 2);
  assert.deepEqual(childMarkdown.codeBlocks, [
    {
      label: '/workspace/src/late.txt',
      isEdit: true,
      subAgentInvocationId: 'late-parent'
    }
  ]);
  assert.equal(childTool.toolCallId, 'late-child');
});

test('mapChatSessionDocument keeps tool-started thinking groups open through following tools and thinking parts', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-8',
    requests: [
      {
        requestId: 'request-8',
        message: { text: 'Verify the final files' },
        response: [
          { value: 'Run the final checks.' },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_getErrors',
            toolCallId: 'check-files',
            generatedTitle: 'Reviewed 2 files and updated tasks and validation',
            isComplete: true,
            pastTenseMessage: { value: 'Checked two files, no problems found' }
          },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_readFile',
            toolCallId: 'read-first',
            generatedTitle: 'Reviewed 2 files and updated tasks and validation',
            isComplete: true
          },
          {
            kind: 'thinking',
            value: '**Updating tasks and validation**\n\nUpdate the completion state.'
          },
          { kind: 'thinking', value: '' },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'manage_todo_list',
            toolCallId: 'update-tasks',
            generatedTitle: 'Reviewed 2 files and updated tasks and validation',
            isComplete: true,
            toolSpecificData: { kind: 'todoList', todoList: [] }
          },
          {
            kind: 'thinking',
            generatedTitle: 'Reviewed 2 files and updated tasks and validation',
            value: '**Deciding on git commitment**\n\nSkip the commit.'
          },
          { kind: 'thinking', value: '' },
          { value: 'Final answer.' }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const thinkingPart = responsePartAt(responseParts, 1, 'thinking');
  assert.equal(responseParts.length, 3);
  assert.equal(responseParts[0].type, 'markdown');
  assert.equal(thinkingPart.title, 'Reviewed 2 files and updated tasks and validation');
  assert.deepEqual(
    thinkingPart.children.filter((part) => part.type === 'tool').map((part) => part.toolCallId),
    ['check-files', 'read-first', 'update-tasks']
  );
  assert.equal(
    thinkingPart.children.some((part) => part.type === 'markdown' && part.text.includes('**Deciding on git commitment**')),
    true
  );
  assert.equal(responsePartAt(responseParts, 2, 'markdown').text, 'Final answer.');
});

test('mapChatSessionDocument routes text edit groups through edit annotations and suppresses placeholder fences', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-9',
    requests: [
      {
        requestId: 'request-9',
        message: { text: 'Add the Windows demo entry' },
        response: [
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'documenter-root',
            isComplete: true,
            toolSpecificData: {
              kind: 'subagent',
              agentName: 'documenter',
              description: 'Add Windows demo entry'
            }
          },
          { value: '```\n' },
          { kind: 'undoStop', id: 'undo-1' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/workspace/README.md', path: '/workspace/README.md', scheme: 'file' },
            isEdit: true,
            subAgentInvocationId: 'documenter-root'
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/workspace/README.md', path: '/workspace/README.md', scheme: 'file' },
            edits: [{ text: 'first edit' }],
            done: true
          },
          { value: '\n```\n\n```\n' },
          { kind: 'undoStop', id: 'undo-2' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/workspace/demo.ps1', path: '/workspace/demo.ps1', scheme: 'file' },
            isEdit: true,
            subAgentInvocationId: 'documenter-root'
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/workspace/demo.ps1', path: '/workspace/demo.ps1', scheme: 'file' },
            edits: [{ text: 'second edit' }],
            done: true
          },
          { value: '\n```\n\n```\n' },
          { kind: 'undoStop', id: 'undo-3' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/workspace/README.md', path: '/workspace/README.md', scheme: 'file' },
            isEdit: true,
            subAgentInvocationId: 'documenter-root'
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/workspace/README.md', path: '/workspace/README.md', scheme: 'file' },
            edits: [{ text: 'third edit' }],
            done: true
          },
          { value: '\n```\n\n' },
          {
            kind: 'toolInvocationSerialized',
            toolId: 'copilot_getErrors',
            toolCallId: 'check-edits',
            subAgentInvocationId: 'documenter-root',
            isComplete: true
          }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const subagentPart = responsePartAt(responseParts, 0, 'subagent');
  assert.equal(responseParts.length, 1);
  assert.deepEqual(
    subagentPart.children.filter((part) => part.type === 'edit').map((part) => part.uri),
    ['/workspace/README.md', '/workspace/demo.ps1', '/workspace/README.md']
  );
  assert.equal(subagentPart.children.some((part) => part.type === 'markdown'), false);
  assert.equal(responsePartAt([subagentPart.children.at(-1)!], 0, 'tool').toolCallId, 'check-edits');
});

test('mapChatSessionDocument inherits subagent routing from serialized edit annotations', () => {
  const document = mapChatSessionDocument(summary, {
    sessionId: 'session-10',
    requests: [
      {
        requestId: 'request-10',
        message: { text: 'Restore an annotated edit' },
        response: [
          {
            kind: 'toolInvocationSerialized',
            toolId: 'runSubagent',
            toolCallId: 'serialized-root',
            isComplete: true,
            toolSpecificData: { kind: 'subagent', description: 'Apply serialized edit' }
          },
          {
            value: '```\n<vscode_codeblock_uri isEdit subAgentInvocationId="serialized-root">/workspace/serialized.md</vscode_codeblock_uri>'
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/workspace/serialized.md', path: '/workspace/serialized.md', scheme: 'file' },
            edits: [{ text: 'serialized edit' }],
            done: true
          },
          { value: '\n```\n' }
        ]
      }
    ]
  });

  const responseParts = document.turns[0].responseParts;
  const subagentPart = responsePartAt(responseParts, 0, 'subagent');
  const editPart = responsePartAt(subagentPart.children, 0, 'edit');
  assert.equal(responseParts.length, 1);
  assert.equal(subagentPart.children.length, 1);
  assert.equal(editPart.uri, '/workspace/serialized.md');
});
