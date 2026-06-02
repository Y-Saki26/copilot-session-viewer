# GitHub Copilot Chat ログ保存形式と表示仕様調査

作成日: 2026-05-17

## 目的

Copilot Session Viewer で VS Code の Copilot Chat パネルに近い会話表示を段階的に実装するため、GitHub Copilot / VS Code のチャット保存形式と、ログビューア側の読み取り・表示仕様を整理する。

調査対象:

- `resources/workspaceStorage/`: 実際の `%AppData%\Code\User\workspaceStorage` からコピーされたサンプルログ
- `resources/microsoft/vscode/`: VS Code 本体の現行実装
- `resources/microsoft/vscode-copilot-chat/`: Copilot Chat 拡張の旧実装。現行の永続化仕様は VS Code 本体側を優先する

## 結論

現行 VS Code のローカルチャット履歴は、ワークスペースごとに次の場所へ保存される。

```text
%AppData%\Code\User\workspaceStorage\<workspaceId>\chatSessions\<sessionId>.jsonl
```

サンプルでは同じ `<workspaceId>` 配下に以下も存在する。

```text
workspace.json
state.vscdb
state.vscdb.backup
chatSessions/*.jsonl
chatEditingSessions/<sessionId>/state.json
chatEditingSessions/<sessionId>/contents/<contentHash>
GitHub.copilot-chat/
```

会話本文は単純な JSON ではなく、`.jsonl` の追記型 mutation log である。1 行目に完全な初期スナップショットが入り、以降の行でプロパティ更新・配列追記・削除を積む。したがって、チャット全文表示では JSONL 全行を順に適用して `ISerializableChatData` 相当の最終状態を復元する必要がある。

既存ビューアのタイトル抽出は `kind:0` と一部の `kind:1` だけを読む簡易実装として妥当だが、会話表示には不足する。特に `requests` 配列と `requests[n].response` 配列は `kind:2` で追記されるため、`kind:2` を処理しないと会話ターン・thinking・ツール使用の多くを読めない。

## VS Code 側の保存仕様

### 保存場所

VS Code 本体の `ChatSessionStore` は、通常ワークスペースでは次を保存先にする。

```text
environmentService.workspaceStorageHome/<workspaceId>/chatSessions
```

空ウィンドウの場合は `globalStorageHome/emptyWindowChatSessions` が使われ、旧形式として `workspaceStorageHome/no-workspace/chatSessions` からの読み取りも残っている。

保存ファイルは次の 2 系統を考慮する。

- 現行: `<sessionId>.jsonl`
- 旧形式または設定でログ保存を無効化した場合: `<sessionId>.json`

`chat.useLogSessionStorage` が `false` でない限り、現行は `.jsonl` が優先される。読み取り時も `.jsonl` を先に試し、なければ `.json` にフォールバックする。

### index

セッション一覧用のメタデータは `chat.ChatSessionStore.index` というキーで VS Code の storage service に保存される。ワークスペースでは通常 `state.vscdb` に入る。

この index は一覧高速化に有用だが、ログビューア初期実装では必須にしない。理由:

- サンプルと実データの `chatSessions/*.jsonl` だけで本文復元できる
- `state.vscdb` の SQLite 読み取りは VS Code の storage service 実装差分に依存する
- index はキャッシュであり、本文の正本は session file 側

将来の高速化としては、`state.vscdb` から index を読める場合だけ一覧初期表示に使い、本文表示では必ず session file を復元する方針が安全。

## JSONL mutation log

VS Code 本体の `ObjectMutationLog` は、各行を次の entry として扱う。

```ts
type Entry =
  | { kind: 0; v: unknown }
  | { kind: 1; k: (string | number)[]; v: unknown }
  | { kind: 2; k: (string | number)[]; v?: unknown[]; i?: number }
  | { kind: 3; k: (string | number)[] };
```

意味:

| kind | 意味 | ビューア側処理 |
|---:|---|---|
| `0` | 初期完全スナップショット | `state = v` に置き換える。原則 1 行目 |
| `1` | オブジェクトプロパティの set | `state[k[0]]...[k[n]] = v` |
| `2` | 配列への push / splice | `k` の配列へ `v` を push。`i` がある場合は先に `splice(i)` |
| `3` | プロパティ削除 | VS Code 実装上は対象パスに `undefined` を set |

ログビューアの復元ルール:

1. 空行は無視する。
2. `kind:0` が出るまで `kind:1/2/3` は不正として警告にする。
3. JSON パース失敗行は、その session file を壊れているものとして扱う。部分復元を許す場合も UI に警告を出す。
4. `kind:2` の対象が配列でない場合は復元失敗にする。
5. 復元結果には `sourcePath`, `workspaceId`, `workspaceFolder`, `mtime` を viewer metadata として付与する。

## 復元後の会話データ構造

復元結果は概ね `ISerializableChatData3` に対応する。

主要フィールド:

| フィールド | 意味 |
|---|---|
| `version` | 現行サンプルでは `3` |
| `sessionId` | ファイル名の UUID と一致する想定 |
| `creationDate` | セッション作成時刻の ms epoch |
| `customTitle` | ユーザーまたは VS Code が付けたタイトル |
| `initialLocation` | `panel` など |
| `responderUsername` | 例: `GitHub Copilot` |
| `inputState` | 現在の入力欄状態、添付、モード、選択モデル |
| `requests` | 会話ターン配列 |
| `pendingRequests` | キュー済み未処理リクエスト |
| `hasPendingEdits` | 編集セッションが残っているか |
| `repoData` | エクスポート用のリポジトリ状態 |
| `workingDirectory` | セッションに紐づく作業ディレクトリ |

`requests[]` の主要フィールド:

| フィールド | 意味 |
|---|---|
| `requestId` | ターン ID |
| `timestamp` | ユーザー送信時刻の ms epoch |
| `message` | ユーザープロンプト。現行は `{ text, parts }` 形 |
| `variableData` | 添付ファイル、コンテキスト、プロンプトファイルなど |
| `agent` | 応答した agent 情報 |
| `modelId` | 使用モデル |
| `modeInfo` | ask/edit/agent や permission level |
| `responseId` | 応答 ID |
| `response` | 応答パーツ配列 |
| `modelState` | 応答状態 |
| `result` | agent result / error detail |
| `contentReferences` | 参照したファイル等 |
| `codeCitations` | コード引用 |
| `completionTokens`, `elapsedMs`, `timeSpentWaiting` | 統計・タイミング |

## response パーツの表示仕様

VS Code の表示は `chatListRenderer.ts` が `response` 内の各 part を `kind` ごとに個別 UI へ振り分ける。ログビューアではまず VS Code の DOM 実装を完全移植せず、正規化済みの viewer part に変換してから段階的に表示する。

### 正規化方針

保存上の `response` には次が混在する。

- `kind` を持つ structured part
- `kind` を持たない `MarkdownString` 相当の object。主に `{ value, supportThemeIcons, supportHtml, baseUri }`
- 旧形式の string response

viewer 側では次のように正規化する。

```ts
type ViewerResponsePart =
  | { type: 'markdown'; markdown: string; raw: unknown }
  | { type: 'thinking'; text: string; done: boolean; title?: string; raw: unknown }
  | { type: 'tool'; toolId: string; toolCallId: string; title: string; status: ToolStatus; detail?: ViewerToolDetail; raw: unknown }
  | { type: 'edit'; uri?: string; done?: boolean; summary: string; raw: unknown }
  | { type: 'reference'; label: string; uri?: string; raw: unknown }
  | { type: 'control'; kind: string; raw: unknown }
  | { type: 'unknown'; kind?: string; raw: unknown };
```

`MarkdownString` 相当は `type: 'markdown'` にする。VS Code 側では復元時に string を `MarkdownString` に戻しているため、ログビューアでは `value` を本文として扱えばよい。

### 優先対応 part

サンプル 41 セッションを復元して確認した response part は多い順に次の通り。

| kind | 件数 | 初期表示方針 |
|---|---:|---|
| `toolInvocationSerialized` | 6131 | 折りたたみツール行。タイトル、状態、入出力概要を表示 |
| MarkdownString object | 1941 | 通常の assistant markdown |
| `thinking` | 1914 | 折りたたみ thinking ブロック |
| `textEditGroup` | 561 | ファイル編集ブロック。対象 URI と edit 数を表示 |
| `inlineReference` | 435 | インライン参照。初期は小さな参照行 |
| `undoStop` | 133 | 表示しない control part |
| `codeblockUri` | 133 | 直後/直前の markdown または edit と関連付け。初期は control |
| `elicitationSerialized` | 120 | ユーザー確認・質問ブロック |
| `mcpServersStarting` | 77 | MCP サーバー開始通知 |
| `progressTaskSerialized` | 64 | タスク進行状況 |
| `questionCarousel` | 30 | 選択肢 UI。初期は質問と選択肢を静的表示 |
| `confirmation` | 12 | 確認 UI。初期は確認メッセージを静的表示 |

### thinking

保存形:

```ts
interface IChatThinkingPart {
  kind: 'thinking';
  value?: string | string[];
  id?: string;
  metadata?: Record<string, unknown>;
  generatedTitle?: string;
}
```

表示方針:

- `value` が空文字または空配列の場合は、VS Code と同じく「thinking 終了マーカー」として扱い、独立表示しない。
- `metadata.vscodeReasoningDone === true` がある場合も完了状態として扱う。
- 同じ `id` の thinking part が連続する場合は同一 thinking block としてまとめる候補にする。
- 初期 UI では「Thinking」見出しの折りたたみブロックとして `value` を markdown/text 表示する。
- 将来は VS Code の `chat.agent.thinkingStyle` 相当として `collapsedPreview` / `expanded` を設定化する。

### toolInvocationSerialized

保存形の主要フィールド:

```ts
interface IChatToolInvocationSerialized {
  kind: 'toolInvocationSerialized';
  presentation?: 'hidden' | 'hiddenAfterComplete' | unknown;
  toolSpecificData?: unknown;
  invocationMessage: string | MarkdownString;
  originMessage?: string | MarkdownString;
  pastTenseMessage?: string | MarkdownString;
  resultDetails?: unknown;
  isConfirmed?: unknown;
  isComplete: boolean;
  toolCallId: string;
  toolId: string;
  source?: unknown;
  subAgentInvocationId?: string;
  generatedTitle?: string;
  isAttachedToThinking?: boolean;
}
```

タイトルの優先順:

1. `generatedTitle`
2. `pastTenseMessage.value`
3. `pastTenseMessage`
4. `invocationMessage.value`
5. `invocationMessage`
6. `toolId`

状態:

- `isComplete === true`: completed
- `isConfirmed.type === 0` または denied 相当: denied
- `isComplete !== true`: running / incomplete
- `presentation === 'hidden'`: 初期表示では非表示。ただし raw 表示モードでは表示可能にする

`toolSpecificData.kind` 別の初期表示:

| kind | 表示 |
|---|---|
| `todoList` | To Do 一覧。`status` ごとに表示 |
| `terminal` | コマンド、cwd、exitCode、出力を折りたたみ表示 |
| `input` | raw input を JSON / text として表示 |
| `simpleToolInvocation` | input/output を表示 |
| `resources` | URI / Location のリスト |
| `search` | 検索ツール実行としてタイトル表示 |
| `subagent` | subagent 名・説明・結果をまとめる |
| `modifiedFilesConfirmation` | 対象ファイル一覧と選択肢 |
| その他 | toolId と raw JSON の要約 |

VS Code は一部の tool / edit / markdown を thinking コンテナ内に pin する。ログビューア初期版でも `isAttachedToThinking`、または直前の active thinking block を見てツールを thinking の下に入れる。ただし完全再現は後続段階とし、まずは順序を保った独立 part 表示でよい。

現行 VS Code は pin 対象 tool が thinking より先に現れた場合も synthetic thinking container を作る。
後続の thinking と pin 対象 tool は、Markdown などの非 pin part が現れるまで同じ container へ順序を
保って追加される。空 thinking marker は ID 更新の区切りだが、container 自体を閉じない。

`toolSpecificData.kind === "subagent"` かつ自身に `subAgentInvocationId` がない親 tool は例外である。
現行 VS Code は親の `toolCallId` を effective ID とする専用 dropdown に置き換え、同じ ID を
`subAgentInvocationId` に持つ child tool、hook、edit code block をその内側へ表示する。child tool は
thinking へ pin しない。parallel subagent は ID ごとに分離し、CLI 由来の深い nested subagent が
root ancestor ID を持つ場合は root dropdown へ畳み込む。
edit 用 `codeblockUri` の直後にある `textEditGroup` は annotation の `subAgentInvocationId` を継承する。
間にある `undoStop` は無視し、edit UI 用のコードフェンスだけの Markdown は本文として表示しない。

### textEditGroup と chatEditingSessions

`textEditGroup` は response part 内に対象 URI と edits を持つ。サンプルでは `chatEditingSessions/<sessionId>/state.json` もあり、編集前後のファイル内容は `contents/<hash>` に分離保存される。

`chatEditingSessions` の構造:

```text
chatEditingSessions/<sessionId>/state.json
chatEditingSessions/<sessionId>/contents/<hash>
```

`state.json` には `version`, `initialFileContents`, `timeline`, `recentSnapshot` があり、`initialFileContents` や snapshot entry は content hash で `contents/` を参照する。

初期表示:

- `textEditGroup.uri`、`edits.length`、`done` を表示
- `chatEditingSessions/<sessionId>/state.json` が存在する場合は、変更ファイル一覧と snapshot の有無を表示
- ファイル内容 diff の再現は後続段階。`contents/<hash>` を読める場合にだけ詳細展開する

## ログビューア実装仕様

### 読み取り API

既存 `CopilotSessionScanner` は一覧用に残し、本文表示用に別レイヤーを追加する。

```ts
interface ChatSessionDocument {
  id: string;
  title: string;
  workspaceHash: string;
  workspaceName: string;
  workspaceFolder?: string;
  sourcePath: string;
  createdAt?: number;
  updatedAt: number;
  data: SerializableChatData;
  turns: ChatTurn[];
  warnings: ScanWarning[];
}

interface ChatTurn {
  requestId: string;
  timestamp?: number;
  userText: string;
  attachments: ViewerAttachment[];
  agentName?: string;
  modelId?: string;
  mode?: string;
  responseState?: string;
  responseParts: ViewerResponsePart[];
  contentReferences: ViewerReference[];
  codeCitations: ViewerCodeCitation[];
  stats: {
    completionTokens?: number;
    elapsedMs?: number;
    timeSpentWaiting?: number;
  };
}
```

追加候補モジュール:

```text
src/chatLogDecoder.ts        JSONL / JSON を SerializableChatData に復元
src/chatDocumentMapper.ts    SerializableChatData を ChatSessionDocument に正規化
src/chatPartMapper.ts        response part を ViewerResponsePart に変換
src/chatEditingReader.ts     chatEditingSessions の state と contents を必要時に読む
```

### 一覧スキャンとの関係

一覧:

- VS Code ユーザーストレージ root 配下の `workspaceStorage` と `globalStorage` を走査する
- `workspaceStorage/*/chatSessions` と `globalStorage/emptyWindowChatSessions` の `*.jsonl` と `*.json` を対象にする
- デバッグ用サンプルは workspaceStorage root を直接追加して走査できる
- タイトル・作成日・更新日だけを高速抽出して cache に保存する
- 将来、`state.vscdb` の index 読み取りを optional acceleration として追加可能

本文表示:

- セッション選択時に `sourcePath` を読み、JSONL 全体を復元する
- 大きいファイルがあるため、一覧スキャン時に全文復元しない
- 復元結果を extension host 側で必要最小限の `ChatSessionDocument` に正規化して webview へ送る
- raw data は UI から要求された part だけ追加送信する方式を検討する

サンプルでは最大 96MB 程度の `.jsonl` があった。webview へ全 raw を一括送信すると重くなるため、初期表示は正規化済み summary を送り、part 展開時に raw/detail を遅延ロードする。

### UI 段階計画

Phase 1: 復元と基本ターン表示

- セッション一覧から 1 件選択
- ユーザープロンプト、assistant markdown、thinking、tool のタイトル行を時系列表示
- `toolInvocationSerialized` は折りたたみ、初期はタイトルと toolId のみ
- raw JSON 表示を各 part に付ける

Phase 2: VS Code 風 part 表示

- thinking の中に関連 tool/edit をまとめる
- terminal / todoList / simpleToolInvocation / resources を専用表示
- textEditGroup と編集ファイル一覧を表示
- contentReferences / codeCitations を応答末尾に表示

Phase 3: 編集・diff 再現

- `chatEditingSessions/<sessionId>/state.json` を読む
- `contents/<hash>` から before/after を復元
- `textEditGroup` と対応する diff を表示
- `codeblockUri` と markdown code block の関連付けを改善

Phase 4: 高速化と互換性

- `state.vscdb` の `chat.ChatSessionStore.index` を optional に読む
- 復元結果の cache schema を追加
- 旧 `.json` 形式、破損 JSONL、途中保存中セッションへの耐性を強化

## エラー処理仕様

| ケース | 表示 |
|---|---|
| root が存在しない | warnings に追加。既存仕様を維持 |
| `workspace.json` が壊れている | workspace hash を名前にして継続 |
| session file が読めない | セッション単位で warning |
| JSONL の初期 entry がない | 本文表示不可。タイトル一覧ではファイル名 fallback |
| JSONL の途中行が壊れている | 本文表示では復元失敗を基本。将来 partial mode を検討 |
| 未知の response kind | `unknown` part として raw 表示 |
| URI reviver 未実装 | `$mid`, `fsPath`, `external`, `path`, `scheme` をそのまま保持し、表示時に best effort で label 化 |

## 参考コード

- `resources/vscode/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts`
  - 保存先、`.jsonl` / `.json` フォールバック、index key、読み取り処理
- `resources/vscode/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts`
  - JSONL mutation log の entry schema と apply 処理
- `resources/vscode/src/vs/workbench/contrib/chat/common/model/chatSessionOperationLog.ts`
  - chat model のどのプロパティを保存するか
- `resources/vscode/src/vs/workbench/contrib/chat/common/model/chatModel.ts`
  - `ISerializableChatData`, `ISerializableChatRequestData`, `SerializedChatResponsePart`
- `resources/vscode/src/vs/workbench/contrib/chat/common/chatService/chatService.ts`
  - `IChatThinkingPart`, `IChatToolInvocationSerialized`, terminal/tool specific data
- `resources/vscode/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts`
  - response part の `kind` ごとの表示分岐、thinking への pin 判定
- `resources/vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSessionStorage.ts`
  - `chatEditingSessions/<sessionId>/state.json` と `contents/<hash>` の構造

## 次の実装タスク

1. `src/chatLogDecoder.ts` を追加し、`.jsonl` の `kind:0/1/2/3` を完全復元する。
2. `src/chatDocumentMapper.ts` を追加し、`requests[]` を `ChatTurn[]` に変換する。
3. `src/chatPartMapper.ts` を追加し、`MarkdownString`, `thinking`, `toolInvocationSerialized`, `textEditGroup` を優先対応する。
4. webview にセッション選択 UI と本文表示 message を追加する。
5. 大きい session file 対策として、本文復元は選択時に行い、raw/detail は遅延送信する。
6. `resources/workspaceStorage` の代表セッションで復元テストを追加する。
