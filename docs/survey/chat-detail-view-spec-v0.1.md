# チャット詳細ビュー仕様 — VSCode チャット画面再現 (v0.1)

> 目標: VSCode の Copilot Chat パネルと同等の表示を Webview で再現することを初期マイルストーンとする。  
> 調査対象リソース: `resources/microsoft/vscode/src/vs/workbench/contrib/chat/` および実データ `resources/workspaceStorage/`
> 上流スナップショット参照: `microsoft/vscode@f067fb52337ad1dedb61fb81283bbd4de6b3d79e`

---

## 1. 調査対象と資料の位置づけ

| 資料 | パス |
|------|------|
| モデル定義 (core) | `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` |
| セッション/ターン | `src/vs/workbench/contrib/chat/common/model/chatModel.ts` |
| ビューモデル | `src/vs/workbench/contrib/chat/common/model/chatViewModel.ts` |
| レンダラー本体 | `src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts` |
| コンテンツパーツ一覧 | `src/vs/workbench/contrib/chat/browser/widget/chatContentParts/` |
| ツール呼び出し型 | `src/vs/workbench/contrib/chat/common/model/chatProgressTypes/chatToolInvocation.ts` |

---

## 2. セッション JSONL の構造

JSONL は VSCode のオブジェクト変異ログ形式で保存されている。  
`ChatLogDecoder.decodeJsonLines()` で適用後に得られる `SerializableChatData` が表示の入力になる。

### 2.1 セッションレベルのフィールド

```
SerializableChatData {
  version         number              フォーマットバージョン (現在 3)
  sessionId       string              UUID
  customTitle     string?             ユーザー設定タイトル
  creationDate    number              ミリ秒タイムスタンプ
  responderUsername string            例: "GitHub Copilot"
  initialLocation string              例: "panel" | "terminal" | "notebook" | "editor"
  requests        SerializableChatRequestData[]
  inputState      { inputText, attachments, mode, selectedModel, selections, permissionLevel, contrib }
  hasPendingEdits boolean?
  pendingRequests SerializablePendingRequestData[]?
  repoData        IExportableRepoData?
  workingDirectory string?
}
```

`initialLocation` は保存データ上の互換値である。通常のサイドバー、チャットエディタ、
Quick Chat は `"panel"` として保存される場合がある。
未知値は保持し、ビューア側で enum を狭く固定しない。

### 2.2 リクエスト (ターン) のフィールド

```
SerializableChatRequestData {
  requestId     string    UUID
  timestamp     number    ミリ秒タイムスタンプ
  message       {
    text   string                ユーザー入力テキスト (優先表示)
    parts  IParsedChatRequestTextPart[]  パース済みパーツ (agent メンション等)
  }
  variableData  {
    variables: IChatRequestVariableEntry[]  添付ファイル・コンテキスト
  }
  agent         { id, extensionId, description, ... }   エージェント情報
  response      ResponsePart[]   レスポンスパーツ配列
  modelId       string?          このターンで使用したモデル
  modeInfo      { id, kind, ... }?
  modelState    { value, completedAt? }?
  result        { errorDetails?, details?, ... }?
  contentReferences IChatContentReference[]?
  codeCitations IChatCodeCitation[]?
  completionTokens number?
  elapsedMs     number?
  timeSpentWaiting number?
}
```

**訂正:** 完了済み request の保存データには `attempt` を必須フィールドとして含めない。
pending request の `sendOptions` には保存される場合がある。詳細ビューの通常ターン metadata
としては必須にしない。

### 2.3 パース済みリクエストパーツ (`message.parts`)

| kind | 主なフィールド | 意味 |
|------|------------|------|
| `text` | `text: string` | 通常テキスト |
| `agent` | `agent: { id, description }` | `@agent` メンション |
| `variable` | `variableName: string`, `id: string` | `#file` 等の変数参照 |

表示時は `message.text` を優先し、パーツは補助情報として使う。

### 2.4 変数/添付ファイル (`variableData.variables`)

主な `kind` は次の通り。実データに未出現でも、未知 kind は破棄せず fallback 表示できるようにする。

| kind | 意味 | VSCode 履歴行での扱い |
|------|------|----------------------|
| `promptFile` / `promptText` | prompt file / prompt text | `automaticallyAdded` なら pill を表示しない |
| `file` / `directory` | ファイル、ディレクトリ | pill を表示 |
| `image` / `paste` / `terminalCommand` | 画像、貼り付け、ターミナルコマンド | kind 別 pill を表示 |
| `tool` / `toolset` | 選択ツール、ツールセット | pill を表示 |
| `implicit` / `string` / `symbol` | 暗黙コンテキスト、文字列、シンボル | kind 別 pill を表示 |
| `workspace` | workspace コンテキスト | 履歴行では表示しない |
| その他 | diagnostic、SCM、notebook output、browser view 等 | kind 別または汎用 pill |

---

## 3. レスポンスパーツ型の一覧

実データから確認できたパーツ kind の一覧とフィールド定義を示す。

### 3.1 Markdown コンテンツ (kind なし — `markdownContent`)

VSCode 内部では kind `markdownContent` として扱われるが、**JSONL に保存されるときは `kind` フィールドが省略され、`value` フィールドのみ**を持つオブジェクトとして現れる。

```jsonc
{
  "value": "マークダウン本文...",
  "supportThemeIcons": false,
  "supportHtml": false,
  "baseUri": { "$mid": 1, "external": "file:///...", ... },
  "uris": { "file:///...": { ... } }   // インライン URI マップ (省略可)
}
```

**表示仕様:**
- `value` を Markdown としてレンダリングする
- コードブロック (` ```lang ... ``` `) は syntax highlight を適用する
- `uris` に登録された URI はインラインリンクとして処理する (`inlineReference` 参照)
- セキュリティ: ユーザーデータ由来のため、HTML はサニタイズする (`DOMPurify` 等)

---

### 3.2 Thinking パーツ (`kind: "thinking"`)

```jsonc
{
  "kind": "thinking",
  "value": "推論テキスト...",   // string | string[]、空文字は「完了」シグナル
  "id": "base64エンコードされた識別子",
  "generatedTitle": "Searching for image files",  // 省略可
  "metadata": { ... }   // 省略可
}
```

**VSCode の表示:**
- 初期ヘッダは本文先頭の `**見出し**`、なければ `"Thinking"`
- 完了時は保存済み `generatedTitle` があればヘッダへ反映する
- `value` が空文字や空配列の part は終了マーカーであり、独立表示しない
- 応答中は設定に応じて折りたたみ、preview、固定高スクロール表示を切り替える
- 完了時は check icon を表示する
- tool、edit、edit code block、tool hook を同じ thinking コンテナへまとめる場合がある

**実装仕様:**
- `<details>/<summary>` で折りたたみを実装する
- summary テキスト: 保存済み完了タイトル、本文先頭の見出し、固定ラベル `"Thinking"` の順に、利用できる最初の値を使う
- content: `value` を Markdown レンダリングする (単純テキストでも可)
- `value` が空 → 直前の thinking コンテナを完了扱いにし、この part 自体は描画しない
- 静的履歴では完了済みとして check icon を表示し、初期は折りたたむ

---

### 3.3 ツール呼び出し (`kind: "toolInvocationSerialized"`)

```jsonc
{
  "kind": "toolInvocationSerialized",
  "toolId": "copilot_findFiles",
  "toolCallId": "call_p1HEvmTewsPRcwTm3WRWjW6j",
  "generatedTitle": "Searched for files matching image patterns",  // 省略可
  "invocationMessage": {                // IMarkdownString — 実行中のメッセージ
    "value": "`pattern` に一致するファイルを検索しています",
    "supportThemeIcons": false, ...
  },
  "pastTenseMessage": {                 // IMarkdownString — 完了後のメッセージ
    "value": "`pattern` に一致するファイルを検索しました。1 件",
    ...
  },
  "isConfirmed": { "type": 1 },        // ConfirmedReason オブジェクト (or boolean)
  "isComplete": true,                  // 保存済み serialized part は完了済み
  "source": { "type": "internal", "label": "Built-In" },
  "resultDetails": [...],              // URI[] | IToolResultInputOutputDetails | ...
  "toolSpecificData": { ... },         // ツール固有データ (省略可)
  "presentation": "default" | "hidden" | "hiddenAfterComplete" | undefined,
  "isAttachedToThinking": false
}
```

#### ツール表示タイトル

完了済み履歴では、完了後メッセージがあれば表示し、なければ呼び出し時メッセージを表示する。

**訂正:** `generatedTitle` は主に thinking コンテナの完了タイトルとして共有される。
独立した tool 行の通常タイトルとして最優先にすると VSCode 本体と異なる。
本拡張で両メッセージが空の未知 tool を fallback 表示する場合だけ `toolId` を使う。

**VSCode の表示:**
- 折りたたみ可能な「ツール呼び出し」ブロックとして表示
- `presentation: "hidden"` または `"hiddenAfterComplete"` (かつ isComplete) は非表示
- `isAttachedToThinking: true` のときは thinking ブロック内にネストして表示
- 完了状態 (`isComplete: true`): ツールアイコン + タイトル。完了後メッセージを優先し、なければ呼び出し時メッセージを使う
- 実行中 (`isComplete: false`): スピナー + invocationMessage

保存済みログを表示する本拡張では `toolInvocationSerialized` は完了済みとして扱う。
実データの serialized part もすべて完了済みだった。
実行中 UI は将来 live session を表示する場合にのみ必要である。

**resultDetails の種別:**

| 種別 | 型 | 説明 |
|------|----|------|
| URI 配列 | `{ $mid, fsPath, external, path, scheme }[]` | ファイル一覧 (findFiles 等) |
| 入出力 | `IToolResultInputOutputDetails { input, inputLanguage?, output, isError? }` | コマンド入出力 |
| シリアライズ済み | `IToolResultOutputDetailsSerialized` | バイナリ出力等 |

**実装仕様:**
- `<details>/<summary>` でツールブロックを折りたたむ
- summary: ツールアイコン相当 (`🔧`) + 表示タイトル
- live part の `isComplete: false` → summary にスピナークラスを付ける
- `resultDetails` が URI 配列 → ファイルパスのリストを表示
- `resultDetails` が入出力 → `input`/`output` を preformatted で表示

#### `toolSpecificData` の初期対応

保存データでは `toolSpecificData` が `resultDetails` より具体的な表示情報を持つ場合がある。Phase 1B では、少なくとも実データで確認できた次の種別を専用表示する。

| `kind` | 保持・表示する内容 |
|---|---|
| `terminal` | コマンド、`cwd`、終了コード、実行時間、出力。コマンド候補が複数ある場合は、表示用 override、表示用文字列、ユーザー編集後、ツール編集後、原文の順に利用可能な最初の値を使う。旧形式の `command` も受理する。専用の terminal 出力があれば共通 result より優先する |
| `todoList` | `todoList[]` の `id`、`title`、`status` を読み取り専用一覧で表示する |
| `subagent` | `agentName`、`description`、`prompt`、`result`、`modelName` を表示し、`toolCallId` / `subAgentInvocationId` によるグルーピングにも利用する |
| `input` | `rawInput` を JSON またはテキストとして表示し、存在する場合は `mcpAppData` も保持する |
| なし | `resultDetails`、`pastTenseMessage`、`invocationMessage` による共通表示へフォールバックする |

上流型には `simpleToolInvocation`、`resources`、`search`、`modifiedFilesConfirmation`、`extensions`、`pullRequest` もある。サンプル未出現でも破棄せず、未知種別と同様に折りたたみ可能な詳細表示へフォールバックする。

#### subagent dropdown の grouping

現行 upstream の `ChatSubagentContentPart` は、subagent 呼び出しを通常 tool 行として描画せず、
専用の折りたたみ dropdown に置き換える。静的履歴ビューでも同じ観察可能な構造を再現する。

| part | dropdown の effective ID | 表示位置 |
|---|---|---|
| 親 subagent tool | `toolSpecificData.kind === "subagent"` かつ自身の `subAgentInvocationId` がない場合の `toolCallId` | dropdown 自体。通常 tool child として重複表示しない |
| 子 tool | `subAgentInvocationId` | 同じ ID の dropdown 内 |
| subagent 由来 edit code block | `codeblockUri.subAgentInvocationId`、または serialize 後の `<vscode_codeblock_uri ... subAgentInvocationId="...">` | 同じ ID の dropdown 内 |
| subagent hook | `hook.subAgentInvocationId` | 同じ ID の dropdown 内 |

- edit 用 `codeblockUri` と直後の `textEditGroup` は一つの edit block として扱う。`textEditGroup` 自体に
  `subAgentInvocationId` がない場合は annotation の ID を継承する。間にある `undoStop` は無視する。
- edit block の内部表現として挿入されたコードフェンスだけの Markdown (` ``` `) は、独立した Markdown block として表示しない。
- dropdown 見出しは `agentName` または `"Subagent"` と `description` から作る。
- `prompt` と `result` は dropdown 内でさらに折りたたみ可能な section として表示する。
- child tool は通常の thinking container へ入れない。subagent dropdown を優先する。
- parallel subagent は effective ID ごとに別 dropdown を作る。
- Copilot CLI の深い nested subagent は、子孫 tool の `subAgentInvocationId` が root ancestor を指すように
  復元される。この場合は階層ごとの dropdown を新設せず、upstream と同様に root dropdown へ畳み込む。
- 親より先に child が現れる互換ログでは、effective ID だけで fallback dropdown を作り、親を後で読めた時点で
  見出し、prompt、result を補完してよい。

#### 代表的な toolId 一覧

| toolId | 意味 |
|--------|------|
| `copilot_findFiles` | ファイル検索 |
| `copilot_viewImage` | 画像参照 |
| `copilot_readFile` | ファイル読み込み |
| `copilot_createFile` / `copilot_applyPatch` | ファイル編集 |
| `run_in_terminal` | ターミナル実行 |
| `manage_todo_list` | TODO 管理 |
| `runSubagent` | サブエージェント |
| `vscode_askQuestions` | 質問 |
| `copilot_getErrors` | エラー取得 |
| `mcp_*` | MCP ツール (動的) |

---

### 3.4 テキスト編集 (`kind: "textEditGroup"`)

```jsonc
{
  "kind": "textEditGroup",
  "uri": {
    "$mid": 1,
    "fsPath": "c:\\path\\to\\file.md",
    "external": "file:///c%3A/path/to/file.md",
    "path": "/c:/path/to/file.md",
    "scheme": "file"
  },
  "edits": [...],    // TextEdit[][] — 変更内容 (省略可)
  "done": true       // 編集完了フラグ
}
```

**VSCode の表示:**
- diff エディタを表示
- ファイル名 + 変更行数 をヘッダに表示
- `done: false` → "pending" 表示、`done: true` → "completed" 表示

**実装仕様:**
- ファイルパス (`uri.fsPath` または `uri.path`) を正規化して表示
- `edits` の数量を "(N edits)" として付記
- 静的履歴ビューの最初の実装ではファイルパスと編集数を fallback 表示してよい
- VSCode 同等再現の完了条件には、読み取り専用 diff または同等の before/after 表示を含める

---

### 3.5 コードブロック URI 参照 (`kind: "codeblockUri"`)

```jsonc
{
  "kind": "codeblockUri",
  "uri": { "$mid": 1, "fsPath": "...", ... },
  "isEdit": true
}
```

**表示:** 直前の Markdown コードブロックがどのファイルに対応するかを示す情報。  
表示結果では、直前の Markdown コードブロックへ対象 resource と edit 状態が関連付けられる。
本拡張では上流内部の注釈文字列を再利用せず、正規化モデル上の関連付けとして独自に表現する。

**実装仕様:**
- 直前の Markdown パーツの末尾コードブロックと関連付ける
- コードブロックのヘッダに `uri.fsPath` のファイル名を付記する
- `isEdit: true` の場合は編集を示すバッジを付ける
- `subAgentInvocationId` があれば subagent グループとの関連付けに保持する

---

### 3.6 インライン参照 (`kind: "inlineReference"`)

```jsonc
{
  "kind": "inlineReference",
  "inlineReference": {
    "$mid": 1,
    "fsPath": "c:\\path\\to\\file.json",
    "external": "file:///c%3A/path/to/file.json",
    "path": "/c:/path/to/file.json",
    "scheme": "file"
  }
}
```

**表示:** Markdown テキスト内のファイル、Location、workspace symbol 参照。
表示結果では参照ラベルが直前の Markdown 末尾へ合成される。直前が Markdown でなければ
参照ラベルだけの Markdown part を作る。コードフェンスまたは inline code の途中では
Markdown link にせず平文ラベルを挿入する。

**実装仕様:**
- `name` があればラベルに使い、なければ URI / Location の basename または symbol 名を使う
- 通常は Markdown 内インラインリンクとして扱う
- `inlineReference` を独立ブロックとして常時描画しない

---

### 3.7 進行タスク (`kind: "progressTaskSerialized"`)

```jsonc
{
  "kind": "progressTaskSerialized",
  "content": {
    "value": "会話が圧縮されました",
    "isTrusted": false, ...
  },
  "progress": []
}
```

**VSCode の表示:** 折りたたみ可能なタスクブロックを表示。
progress 配列に警告や参照が含まれる場合がある。

**実装仕様:**
- `progress` が空なら `content.value` の進捗行を表示
- `progress` が空でなければ `content.value` を見出しとする折りたたみリストを表示

---

### 3.8 確認ダイアログ履歴 (`kind: "confirmation"`)

```jsonc
{
  "kind": "confirmation",
  "title": "反復処理を続行しますか?",
  "message": {
    "value": "...",
    "isTrusted": { "enabledCommands": ["..."] }, ...
  },
  "data": { ... },
  "buttons": ["続行", "停止"]   // 省略可
}
```

**VSCode の表示:** 承認/拒否ボタン付きのカードを表示。
保存済みセッションでは既に完了しているため、どの選択肢が選ばれたかの情報は別途参照する必要がある。

**実装仕様:**
- タイトルと message を表示する (Markdown レンダリング)
- `isUsed` が true ならボタンを非表示にする
- 履歴ビューは読み取り専用のため、`isUsed` がなくても操作ボタンを有効化しない

---

### 3.9 ユーザー入力リクエスト履歴 (`kind: "elicitationSerialized"`)

```jsonc
{
  "kind": "elicitationSerialized",
  "title": { "value": "ターミナルが入力を待機しています。", ... },
  "message": { "value": "Saved batch 2\r\nターミナルに必要な...", ... },
  "state": "accepted" | "rejected",
  "subtitle": "",
  "isHidden": false,
  "acceptedResult": { ... }  // 省略可
}
```

**VSCode の表示:** ユーザー入力フォームを表示。
保存済みでは `state` によって結果を示す。

**実装仕様:**
- `title.value` と `message.value` を表示
- `state: "accepted"` → ✓ 承認済み、`"rejected"` → ✗ 拒否済み
- `acceptedResult` があれば JSON code block として表示

---

### 3.10 質問カルーセル (`kind: "questionCarousel"`)

```jsonc
{
  "kind": "questionCarousel",
  "questions": [
    {
      "id": "UUID",
      "type": "singleSelect" | "multiSelect" | "text",
      "title": "質問タイトル",
      "message": "説明テキスト",
      "options": [
        { "id": "opt1", "label": "選択肢1", "value": "..." },
        ...
      ],
      "defaultValue": "...",
      "allowFreeformInput": true,
      "required": true,
      "validation": { "minLength": 1 }
    }
  ],
  "allowSkip": false,
  "resolveId": "...",
  "data": { "questionId": "answer" },   // 回答済み時
  "isUsed": true
}
```

**実装仕様:**
- `questions` リストを表示
- `data` に回答が含まれていれば回答済み summary として表示する
- 保存済み履歴では回答操作を有効化しない

---

### 3.11 MCP サーバー起動 (`kind: "mcpServersStarting"`)

```jsonc
{
  "kind": "mcpServersStarting",
  "didStartServerIds": ["playwright", "filesystem"]
}
```

**実装仕様:**
- serialized part は runtime の `state` を持たないため、通常は描画内容なしとする
- metadata 表示では `didStartServerIds` を開示してよい

---

### 3.12 アンドゥストップ (`kind: "undoStop"`)

```jsonc
{ "kind": "undoStop", "id": "UUID" }
```

**実装仕様:** 表示しない (内部マーカー)。

---

### 3.13 上流では保存可能だがサンプル未出現の part

実データに未出現でも保存対象になり得る kind がある。VSCode 同等再現を目標にする場合、未知 part に
落とすだけで完了とはしない。最低限、kind 別 fallback と raw detail を用意し、表示頻度が増えた
kind から専用 UI を追加する。

| kind | 上流の表示 | 本拡張の初期 fallback |
|------|------------|----------------------|
| `progressMessage` | spinner / check 付き進捗行 | Markdown 進捗行 |
| `warning` / `info` | 通知カード | severity 付きカード |
| `treeData` | ファイルツリー | 折りたたみツリーまたはパス一覧 |
| `multiDiffData` | multi diff | 変更ファイル一覧 |
| `notebookEditGroup` | notebook edit 表示 | notebook URI + edit 数 |
| `workspaceEdit` | workspace file edit 表示 | old/new resource 一覧 |
| `command` | command button | 非活性ボタン |
| `extensions` | extension 一覧 | extension ID 一覧 |
| `pullRequest` | PR カード | title、author、リンク |
| `hook` | hook 結果の折りたたみカード | hook type、blocked/warning、message |
| `planReview` | plan review UI | 回答済み summary と plan Markdown |
| `disabledClaudeHooks` | hook 無効通知 | 通知行 |
| `clearToPreviousToolInvocation` | 内部制御 | 表示しない |
| `markdownVuln` | code block vulnerability 注釈 | Markdown + warning 一覧 |

### 3.14 描画時に合成される part

次の part は `response[]` だけを走査しても復元できない。ターン mapper で request の別フィールドを
読み、VSCode と同じ相対位置へ合成する。

| renderer kind | 入力元 | 挿入位置 / 表示 |
|---------------|--------|-----------------|
| `references` | `contentReferences[]` | response の先頭。空なら非表示 |
| `codeCitations` | `codeCitations[]` | response 本文の後。ライセンス一致件数と detail |
| `errorDetails` | `result.errorDetails` | response 本文の後。warning / error card |
| footer detail | `result.details` | response footer |
| `changesSummary` | editing/checkpoint 状態 | 完了 response の後。取得可能な場合のみ |
| `working` | live response 状態 | 静的履歴では不要 |

### 3.15 実データ再集計結果

2026-05-31 に `resources/workspaceStorage/` の 41 session file を JSONL replay して再集計した。
全ファイルを復元できた。77 requests、11,551 response parts の内訳は次の通り。

| kind | 件数 |
|------|-----:|
| `toolInvocationSerialized` | 6131 |
| MarkdownString object | 1941 |
| `thinking` | 1914 |
| `textEditGroup` | 561 |
| `inlineReference` | 435 |
| `codeblockUri` | 133 |
| `undoStop` | 133 |
| `elicitationSerialized` | 120 |
| `mcpServersStarting` | 77 |
| `progressTaskSerialized` | 64 |
| `questionCarousel` | 30 |
| `confirmation` | 12 |

補足:

- `contentReferences[]` は 85 件、`codeCitations[]` は 0 件。ただし mapper 対応は必要。
- `thinking` 終了マーカーは空文字 1043 件、空配列 72 件。
- `toolInvocationSerialized` は 6131 件すべて `isComplete: true`。
- tool 固有データは `terminal` 1127 件、`subagent` 325 件、`todoList` 258 件、
  `input` 245 件、kind なし 4176 件。
- 添付は `promptFile` 66 件、`promptText` 33 件、`file` 19 件。

---

## 4. 本拡張と VSCode のレンダリングパイプライン

```
JSONL ファイル
  ↓ ChatLogDecoder.decodeJsonLines()
SerializableChatData
  ↓ mapChatSessionDocument() [chatDocumentMapper.ts]
ChatSessionDocument {
  turns: ChatTurn[] {
    requestId, timestamp, userText, responseParts[]
  }
}
  ↓ sessionPanel.ts → Webview postMessage
media/main.js (DOM 構築)
  ↓ renderTurn() per turn
  ├─ renderUserMessage() — userText を表示
  └─ renderResponseParts() — 各パーツを種別に応じてレンダリング
```

上流 VSCode 本体では、復元後の response をそのまま 1 part = 1 DOM として描画しない。

```
保存済み request
  ↓ 表示用に正規化
  ├─ contentReferences[] → 先頭の references 表示
  ├─ inlineReference → Markdown 内へ参照ラベルを合成
  ├─ codeblockUri → 直前コードブロックへ resource 情報を関連付け
  ├─ markdownVuln → 対象 Markdown へ警告情報を関連付け
  ├─ codeCitations[] → 本文後の citation 表示
  ├─ result.errorDetails → 本文後の error 表示
  └─ live 状態 → working 表示
       ↓
正規化済み part を順に描画
```

本拡張でも DOM 生成前に同等の正規化段階を設ける。`mapResponsePart()` の 1:1 変換だけでは、
inline reference、code block URI、thinking への tool 集約、synthetic part の順序を再現できない。

表示上の対応関係:

| 処理段階 | VSCode の表示 | 本拡張の独自実装 |
|---------|--------------|----------------|
| モデル → 表示データ変換 | 表示前に関連情報を合成 | `chatDocumentMapper.ts` に独自の正規化処理を追加 |
| ターン毎のレンダリング | request と response を時系列表示 | `media/main.js` で独自に DOM を構築 |
| Markdown 描画 | Markdown とコードブロック | `marked` + `DOMPurify` |
| コードブロック | 読み取りやすいコード表示 | `<pre><code>` + syntax highlight |
| Thinking 折りたたみ | 折りたたみ可能な進捗表示 | `<details>/<summary>` |
| ツール呼び出し | 折りたたみ可能なツール結果 | `<details>/<summary>` |
| テキスト編集 | diff 表示 | 読み取り専用 diff |
| 確認ダイアログ | 選択結果カード | 読み取り専用カード |

---

## 5. Markdown レンダリングの詳細仕様

### 5.1 基本方針

- サードパーティライブラリ `marked` を Webview に読み込んで利用する
- セキュリティ: `DOMPurify` でサニタイズする。`marked` 単体の sanitize 機能へ依存しない
- コードブロック: `highlight.js` で syntax highlight を適用する
- GFM と single newline の改行を有効化する (`gfm: true`, `breaks: true`)
- Webview の CSP を維持するため、ライブラリは CDN 参照せず extension 内へ bundle する

### 5.2 VSCode テーマ変数の利用

Markdown と UI コンポーネントの色は VS Code テーマ CSS 変数を使う (既存の `media/styles.css` 方針に準拠):

```css
--vscode-editor-foreground
--vscode-editor-background
--vscode-textCodeBlock-background
--vscode-textLink-foreground
--vscode-chat-requestBorder
--vscode-chat-slashCommandBackground
--vscode-badge-background / --vscode-badge-foreground
```

### 5.3 コードブロックの表示

VSCode 本体は Monaco Editor でコードブロックを表示するが、本拡張では以下で代替する:

```html
<div class="code-block" data-lang="typescript">
  <div class="code-block-header">
    <span class="code-lang">typescript</span>
    <span class="code-file-link">path/to/file.ts</span>   <!-- codeblockUri があるとき -->
  </div>
  <pre><code class="hljs language-typescript">...</code></pre>
</div>
```

上流は通常の Copilot 行で username と avatar を隠す。metadata header は本拡張独自機能であり、
初期マイルストーンの VSCode 相当表示とは別に追加する。

---

## 6. ターン表示の HTML 構造

```html
<div class="chat-session">
  <!-- 本拡張独自 metadata。初期マイルストーン後に追加し、既定は折りたたみ -->
  <div class="session-header">
    <h2 class="session-title">タイトル</h2>
    <details class="session-meta">
      <span>Created: 2025-05-31 12:00</span>
      <span>Model: GitHub Copilot</span>
    </details>
  </div>

  <!-- ターン (turns[] を順に表示) -->
  <div class="chat-turn" data-request-id="req-1">

    <!-- ユーザーメッセージ -->
    <div class="user-row">
      <div class="user-message">
        <div class="user-text">ユーザーのテキスト</div>
        <!-- 添付ファイル (variableData.variables が存在するとき) -->
        <div class="attachments">
          <span class="attachment-pill">📄 file.ts</span>
        </div>
      </div>
    </div>

    <!-- AI レスポンス -->
    <div class="response-row">
      <div class="response-parts">

        <!-- Markdown パーツ -->
        <div class="response-part markdown-part">
          <!-- marked でレンダリングされた HTML -->
        </div>

        <!-- Thinking パーツ -->
        <details class="response-part thinking-part">
          <summary class="thinking-summary">
            <span class="thinking-icon">💭</span>
            <span class="thinking-title">Searching for image files</span>
          </summary>
          <div class="thinking-content">...</div>
        </details>

        <!-- Tool 呼び出しパーツ -->
        <details class="response-part tool-part">
          <summary class="tool-summary">
            <span class="tool-icon">🔧</span>
            <span class="tool-title">Searched for files matching image patterns</span>
            <span class="tool-status complete">✓</span>
          </summary>
          <div class="tool-result">
            <ul><li>path/to/file.jpg</li></ul>
          </div>
        </details>

        <!-- テキスト編集パーツ -->
        <div class="response-part edit-part">
          <span class="edit-icon">✏️</span>
          <span class="edit-file">path/to/file.md</span>
          <span class="edit-count">(3 edits · completed)</span>
        </div>

      </div>
    </div>

  </div>
</div>
```

---

## 7. `chatDocumentMapper.ts` の現状と拡張方針

### 7.1 現状 (v0.0.3)

`mapResponsePart()` では以下のパーツのみを処理している:

| kind | 処理 | 出力型 |
|------|------|--------|
| (なし) `value` フィールド | Markdown テキスト抽出 | `ViewerMarkdownResponsePart` |
| `thinking` | テキスト抽出 + 完了判定 | `ViewerThinkingResponsePart` |
| `toolInvocationSerialized` | タイトル・ステータス抽出 | `ViewerToolResponsePart` |
| `textEditGroup` | URI + 編集数 | `ViewerEditResponsePart` |
| その他 | kind をラベルに使用 | `ViewerUnknownResponsePart` |

### 7.2 追加対応が必要なパーツ

| kind | 追加すべき型 | 抽出すべき情報 |
|------|------------|-------------|
| `codeblockUri` | Markdown 注釈へ合成 | `uri`, `isEdit`, `subAgentInvocationId` |
| `inlineReference` | Markdown inline link へ合成 | `inlineReference`, `name` |
| `progressTaskSerialized` | `ViewerProgressTaskPart` | `content.value` |
| `confirmation` | `ViewerConfirmationPart` | `title`, `message.value` |
| `elicitationSerialized` | `ViewerElicitationPart` | `title`, `message`, `state`, `acceptedResult` |
| `questionCarousel` | `ViewerQuestionCarouselPart` | `questions[]`, `data`, `isUsed` |
| `mcpServersStarting` | metadata のみ | `didStartServerIds[]` |
| `undoStop` | — | 非表示 |
| Section 3.13 の各 kind | kind 別 fallback | 専用 UI に必要な最小情報、raw detail |

### 7.3 Markdown パーツの強化

現在 `value` フィールドを平文として扱っているが、以下を追加する:
- `baseUri` を保持して相対パスの解決に使う
- `uris` マップを保持して `inlineReference` リンクを解決する

### 7.4 ターン正規化で追加する情報

`ChatTurn` は response part 以外に次を保持する。

| 情報 | 入力元 | 用途 |
|------|--------|------|
| `attachments[]` | `variableData.variables[]` | request 下の pill |
| `contentReferences[]` | request の同名フィールド | response 先頭の used references |
| `codeCitations[]` | request の同名フィールド | response 末尾の citation 表示 |
| `result` / `errorDetails` | request の `result` | footer detail、error card |
| `modelId`, `modeInfo`, `modelState` | request | metadata |
| `isSystemInitiated`, `systemInitiatedLabel` | request | system progress 行 |

### 7.5 DOM 描画前の grouping

part mapper と DOM renderer の間で次を行う。

1. `contentReferences[]` から synthetic references part を先頭に追加する。
2. 保存順に response part を走査する。
3. `inlineReference`、`codeblockUri`、`markdownVuln` は直前 Markdown へ合成する。
4. 空の `thinking` は直前 thinking の終了マーカーとして処理する。
5. 親 subagent tool は effective ID の dropdown を作り、通常 tool 行としては重複表示しない。
6. `subAgentInvocationId` を持つ child tool / hook / edit code block は、thinking より優先して同じ ID の
   subagent dropdown へまとめる。
7. active thinking がない状態で pin 対象 tool が現れた場合も synthetic thinking container を作る。
8. synthetic container の後に thinking part が現れた場合は、新しい block を作らず同じ container へ追記する。
9. 空 thinking は ID 更新の区切りとして扱うが、active container 自体は閉じない。
10. 設定と Section 11.3 の pin 規則に基づき、残りの tool / edit / hook / edit code block を thinking へまとめる。
11. `codeCitations[]` と `result.errorDetails` を末尾に追加する。
12. control part は位置情報を保持したまま DOM を生成しない。

---

## 8. セキュリティ要件

1. ログ由来のすべての文字列を HTML エスケープまたはサニタイズしてから DOM に挿入する
2. Markdown は `marked` + `DOMPurify` でサニタイズする (`innerHTML` に直接渡さない)
3. extension 内へ bundle した script のみ CSP で許可し、CDN script を追加しない
4. `file:` URI は表示リンクとして扱い、クリック時は Webview message 経由で extension host から開く
5. `http:` / `https:` は明示的な外部リンクとしてのみ扱う
6. `command:` URI は履歴ビューではデフォルト非活性とする。将来有効化する場合も固定 allowlist を使い、ログ内の `isTrusted.enabledCommands` だけを信用しない
7. `javascript:`、`data:`、未知 scheme はリンクとして実行しない

---

## 9. ターン/パーツレベルのメタデータ (追加調査より)

### 9.1 ターンレベルの追加フィールド

実データには以下のフィールドが含まれることがある。詳細ビューのメタデータ開示で参照する。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `modelId` | string | ターンで使用したモデル (例: `copilot/claude-opus-4.6`) |
| `inputState.selectedModel.identifier` | string | セッション draft で現在選択中のモデル。ターン metadata とは分ける |
| `modeInfo` | `{ id, kind }` | チャットモード (例: `{ id: "agent", kind: "agent" }`) |
| `agent.id` | string | エージェント識別子 |
| `agent.extensionId.value` | string | 拡張 ID (例: `GitHub.copilot-chat`) |
| `shouldBeRemovedOnSend` | object | 次回送信時に削除されるターン |
| `isSystemInitiated` | boolean | システムが自動生成したターン |
| `systemInitiatedLabel` | string | system progress 行の表示名 |

レスポンス側では以下が含まれる場合がある:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `timeSpentWaiting` | number | ストリーミング開始前の待機時間 (ms) |
| `completionTokens` | number | 使用トークン数 |
| `elapsedMs` | number | 総応答時間 (ms) |

### 9.2 パーツレベルの安定 ID

各正規化パーツには安定した内部 ID を付与することで、折りたたみ状態の永続化や差分比較に使う。
推奨 ID 形式: `{requestId}:{partIndex}:{kind}`

複数 part を thinking コンテナへまとめる場合は `{requestId}:thinking:{firstPartIndex}` を
コンテナ ID とし、子 part は元の index を維持する。`codeblockUri` のように DOM を持たない
control part も source index を保持する。

### 9.3 折りたたみ状態の設定キー

上流 VSCode の現在設定は次の通り。

| 上流設定キー | 型 | デフォルト | 説明 |
|-------------|----|-----------|------|
| `chat.agent.thinkingStyle` | `"collapsed"` \| `"collapsedPreview"` \| `"fixedScrolling"` | `"fixedScrolling"` | thinking の表示方式 |
| `chat.agent.thinking.collapsedTools` | `"off"` \| `"withThinking"` \| `"always"` | `"always"` | tool を thinking にまとめる条件 |
| `chat.agent.thinking.terminalTools` | boolean | `true` | terminal tool を thinking 内へ入れるか |
| `chat.inlineReferences.style` | `"box"` \| `"link"` | `"box"` | inline reference の見た目 |

静的履歴ビューでは live streaming 用の `fixedScrolling` を完全再現する必要はない。初期マイルストーンでは
完了済み thinking を collapsed 表示に正規化する。本拡張独自の設定を追加する場合は、上流設定との
対応を崩さない。

| 設定キー | 型 | デフォルト | 説明 |
|---------|----|----------|------|
| `copilotSessionViewer.detail.metadata.defaultVisibility` | `"expanded"` \| `"collapsed"` | `"expanded"` | セッションメタデータの初期表示 |
| `copilotSessionViewer.detail.thinking.defaultMode` | `"collapsed"` \| `"collapsedPreview"` \| `"fixedScrolling"` | `"collapsed"` | Thinking の初期表示モード。静的履歴向け default |
| `copilotSessionViewer.detail.tools.collapsedMode` | `"off"` \| `"withThinking"` \| `"always"` | `"always"` | ツール呼び出しの初期折りたたみ |
| `copilotSessionViewer.detail.thinking.terminalTools` | boolean | `true` | terminal tool を thinking 内へ入れるか |
| `copilotSessionViewer.detail.inlineReferences.style` | `"box"` \| `"link"` | `"box"` | inline reference の見た目 |
| `copilotSessionViewer.detail.references.defaultVisibility` | `"expanded"` \| `"collapsed"` \| `"auto"` | `"auto"` | 参照リストの初期表示 |
| `copilotSessionViewer.detail.unknownParts.defaultVisibility` | `"expanded"` \| `"collapsed"` | `"collapsed"` | 不明パーツの初期表示 |
| `copilotSessionViewer.detail.rememberExpansionState` | boolean | `true` | 折りたたみ状態を永続化するか |

折りたたみ状態の優先順位:
1. ユーザーが明示的にトグルした状態 (セッション ID + パーツ ID で保存)
2. 上記設定のデフォルト値
3. ハードコードされたフォールバック

### 9.4 エクスポート形式

#### JSON エクスポートの推奨構造

```jsonc
{
  "source": {
    "sourcePath": "path/to/session.jsonl",
    "decodeMode": "jsonl-replay",    // "snapshot" | "jsonl-replay"
    "scannedAt": 1748700000000
  },
  "session": {
    // 正規化セッションメタデータ
  },
  "rawSession": {
    // デコード後の SerializableChatData 生データ
  },
  "normalizedDocument": {
    // ChatSessionDocument (turns[] を含む)
  }
}
```

#### Copy Transcript の出力形式

```
[You] 2025-05-31 12:00
ユーザーのテキスト

[GitHub Copilot]
Markdown レスポンステキスト

[Tool: copilot_findFiles] Searched for files matching image patterns
→ path/to/file.jpg

---
[You] 2025-05-31 12:05
次のターン...
```

### 9.5 レスポンスパーツ順序の規則

- `references` 相当パーツ (合成) はレスポンスの先頭に挿入する (Markdown より前)
- それ以降のパーツは保存順を維持する
- 不明パーツを末尾に移動しない
- `undoStop` は表示しないが、配列上の位置は変えない

---

## 10. 実装フェーズ計画

### Phase 1A: 正規化の土台

- `ViewerResponsePart` 型の拡張 (Section 7.2)
- `chatDocumentMapper.ts` の拡張
- DOM 描画前 grouping (Section 7.5)
- `media/main.js` の `renderTurn()` / `renderResponsePart()` 実装
- extension 内へ bundle した `marked` + `DOMPurify` + `highlight.js`
- unknown part の kind 別 fallback と raw detail

### Phase 1B: VSCode 相当の静的履歴表示 (初期マイルストーン)

- request Markdown と表示対象 attachment pill
- assistant Markdown、GFM、コードブロック、syntax highlight
- `contentReferences[]` の先頭 references 行
- `inlineReference` の Markdown 内合成
- `codeblockUri` のコードブロック関連付けとファイル名ヘッダ
- thinking の終了マーカー処理、完了状態、子 part grouping
- tool の hidden 規則、terminal / todoList / input / subagent / result list / input-output 表示
- `textEditGroup` の読み取り専用 diff。復元不能時のみ対象ファイルと edit 数へ fallback
- `progressTaskSerialized`、`confirmation`、`elicitationSerialized`、`questionCarousel`
- `result.errorDetails` と `result.details`
- `codeCitations[]` の fallback 表示
- Section 3.13 の kind 別 fallback
- VS Code theme variable を使ったスタイル

### Phase 2: 同等性の精度向上

- `chatEditingSessions` を使った diff 復元精度向上
- notebook edit、workspace edit、multi diff の専用表示
- hook、plan review、PR、extension、tree の専用 UI
- Codicon 相当 icon、hover action、ファイルをエディタで開く操作
- 長大ログ向け virtual scroll と raw detail 遅延ロード

### Phase 3: 独自機能追加 (将来)

- メタデータオーバーレイ (raw JSON 表示)
- 折りたたみ設定のコンフィグ化
- セッションエクスポート

---

## 11. VSCode 同等再現の境界

### 11.1 許容する差異

| 機能 | VSCode 本体 | 本拡張の初期マイルストーン |
|------|-----------|----------------|
| Markdown | VSCode markdown renderer + Monaco decoration | `marked` + `DOMPurify` + `highlight.js` |
| コードブロック | Monaco Editor (インタラクティブ) | `<pre><code>` (読み取り専用) |
| ファイルリンク | エディタで開く | Phase 1B はラベル必須。open 操作は Phase 2 |
| diff 表示 | Monaco Diff Editor | 読み取り専用 before/after。復元不能時のみ対象ファイルと edit 数へ fallback |
| ストリーミング | 逐次更新 | 不要 (静的表示) |
| 仮想化 | ListView 仮想スクロール | 通常スクロール |
| テーマアイコン | Codicon フォント | CSS またはテキスト代替 |

通常スクロールで性能問題が出る場合は virtual scroll を Phase 2 から前倒しする。サンプルには
最大約 96 MB の session file があるため、raw JSON を初期 `postMessage` に含めない。

### 11.2 許容しない欠落

次は見た目の簡略化ではなく、会話の意味または順序を失うため省略しない。

- request と response の時系列順
- Markdown と code block
- attachment pill の表示対象判定
- `contentReferences[]` と `inlineReference`
- `codeblockUri` と直前 code block の対応
- thinking 終了マーカーと tool / edit grouping
- tool の `presentation` hidden 規則
- `result.errorDetails`
- 未知 part の fallback

### 11.3 thinking 内の grouping 要件

thinking と後続 part の表示結果は次を満たすこと。実装時はこの観察可能な結果を満たす独自ロジックを
設計し、上流の条件分岐を転記しない。

1. thinking の終了マーカーと内部制御 part は、独立した空行として表示しない。
2. edit code block と `textEditGroup` は、直前の active thinking に関連する場合、その内側へ表示する。
3. 通常の serialized tool は、直前の active thinking に関連する場合、その内側へ表示する。
4. MCP、Mermaid、質問、subagent の tool は thinking の外側へ表示する。
5. terminal tool を thinking 内へ表示するかは `terminalTools` 設定へ従う。
6. tool hook は通常の tool 実行に関するものだけを thinking 内へ表示し、subagent hook は外側へ表示する。
7. thinking と無関係な表示 part が現れた後は、後続 part を完了済み thinking の外側へ表示する。
8. pin 対象 tool が thinking より先に現れた場合は synthetic thinking container を作る。
9. synthetic container に続く thinking と pin 対象 tool は、Markdown などの非 pin part が現れるまで同じ
   折りたたみ block に順序を保って追加する。
10. 空 thinking marker だけでは container を閉じない。

### 11.4 subagent dropdown の grouping 要件

1. 親 subagent tool は `toolCallId` を effective ID とする専用 dropdown に置き換え、親 tool 行を重複表示しない。
2. `subAgentInvocationId` を持つ child tool は、同じ effective ID の dropdown 内へ表示する。
3. `subAgentInvocationId` を持つ edit code block と hook も、同じ dropdown 内へ表示する。
4. edit 用 `codeblockUri` の直後にある `textEditGroup` は annotation の ID を継承する。間にある `undoStop` は無視する。
5. edit block 用のコードフェンスだけの Markdown は独立表示しない。
6. subagent dropdown への関連付けは thinking への pin より優先する。
7. parallel subagent は ID ごとに分離する。
8. root ancestor ID を持つ深い child tool は root dropdown へ畳み込む。

### 11.5 受け入れ確認

初期マイルストーンでは、実データから少なくとも次を目視確認する。

| ケース | 確認内容 |
|--------|----------|
| Markdown 中心の session | 見出し、list、link、code block、改行 |
| thinking + tool の session | 終了マーカーが空行として出ず、tool が適切に grouping される |
| terminal tool | command、cwd、exit code、output |
| todoList tool | status 別 To Do |
| subagent tool | 親 tool が専用 dropdown になり、child tool、prompt、result が内側へ入る |
| parallel / nested subagent | ID ごとの分離と root dropdown への畳み込み |
| `inlineReference` | symbol / URI / Location のラベルが Markdown 内へ入る |
| `codeblockUri` | 対応 code block にファイル名と edit 状態が付く |
| `textEditGroup` | 読み取り専用 before/after diff。復元不能時のみ対象ファイルと edit 数へ fallback |
| elicitation / carousel / confirmation | 読み取り専用の履歴 summary |
| unknown part | 順序を維持した fallback と raw detail |
| hidden tool | `hidden` / `hiddenAfterComplete` が通常表示へ出ない |

---

## 12. 上流参照

調査は同梱した `resources/microsoft/vscode/` と、Microsoft 公式 GitHub の `main` を照合した。
Microsoft の VS Code リポジトリは MIT License で公開されているが、本拡張ではライセンス条件に
依存したコード再利用を行わない。次のリンクは調査根拠の監査用であり、実装へコード断片や内部構造を
転記するためには使わない。

- [VS Code LICENSE.txt](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/LICENSE.txt)
- [chatService.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/common/chatService/chatService.ts)
- [chatModel.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/common/model/chatModel.ts)
- [chatSessionOperationLog.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/common/model/chatSessionOperationLog.ts)
- [annotations.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/common/widget/annotations.ts)
- [chatListRenderer.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts)
- [chatSubagentContentPart.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatSubagentContentPart.ts)
- [chatToolInvocationPart.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatToolInvocationPart.ts)
- [runSubagentTool.ts](https://github.com/microsoft/vscode/blob/f067fb52337ad1dedb61fb81283bbd4de6b3d79e/src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts)
