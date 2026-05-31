# チャット詳細ビュー仕様 — VSCode チャット画面再現 (v0.1)

> 目標: VSCode の Copilot Chat パネルと同等の表示を Webview で再現することを初期マイルポイントとする。  
> 調査対象リソース: `resources/microsoft/vscode/src/vs/workbench/contrib/chat/` および実データ `resources/workspaceStorage/`

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
  initialLocation "panel" | "editor" 開始場所
  requests        SerializableChatRequestData[]
  inputState      { inputText, mode, selectedModel, ... }
}
```

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
  attempt       number           リトライ番号 (省略時 0)
}
```

### 2.3 パース済みリクエストパーツ (`message.parts`)

| kind | 主なフィールド | 意味 |
|------|------------|------|
| `text` | `text: string` | 通常テキスト |
| `agent` | `agent: { id, description }` | `@agent` メンション |
| `variable` | `variableName: string`, `id: string` | `#file` 等の変数参照 |

表示時は `message.text` を優先し、パーツは補助情報として使う。

### 2.4 変数/添付ファイル (`variableData.variables`)

| kind | 意味 |
|------|------|
| `promptFile` | `.instructions.md` 等の自動添付ファイル |
| `file` | `#file:` で明示的に添付されたファイル |
| `implicit` | エディタの選択範囲など暗黙的なコンテキスト |

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
- `generatedTitle` があればそれをヘッダに、なければ "Thinking" を使う
- デフォルトは折りたたみ状態
- `value` が空文字や空配列のときは「完了済み」として非アクティブ表示
- 応答中は折りたたんだまま点滅インジケーターを表示することがある

**実装仕様:**
- `<details>/<summary>` で折りたたみを実装する
- summary テキスト: `generatedTitle ?? "Thinking"`
- content: `value` を Markdown レンダリングする (単純テキストでも可)
- `value` が空 → summary に "✓" や "完了" アイコンを付ける

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
  "isComplete": true,
  "source": { "type": "internal", "label": "Built-In" },
  "resultDetails": [...],              // URI[] | IToolResultInputOutputDetails | ...
  "toolSpecificData": { ... },         // ツール固有データ (省略可)
  "presentation": "default" | "hidden" | "hiddenAfterComplete",
  "isAttachedToThinking": false
}
```

#### ツール表示タイトルの優先順位

```
generatedTitle
  ?? pastTenseMessage.value (isComplete=true のとき)
  ?? invocationMessage.value
  ?? toolId
  ?? "Tool invocation"
```

**VSCode の表示:**
- 折りたたみ可能な「ツール呼び出し」ブロックとして表示
- `presentation: "hidden"` または `"hiddenAfterComplete"` (かつ isComplete) は非表示
- `isAttachedToThinking: true` のときは thinking ブロック内にネストして表示
- 完了状態 (`isComplete: true`): ツールアイコン + タイトル (pastTenseMessage / generatedTitle)
- 実行中 (`isComplete: false`): スピナー + invocationMessage

**resultDetails の種別:**

| 種別 | 型 | 説明 |
|------|----|------|
| URI 配列 | `{ $mid, fsPath, external, path, scheme }[]` | ファイル一覧 (findFiles 等) |
| 入出力 | `IToolResultInputOutputDetails { input, output }` | コマンド入出力 |
| シリアライズ済み | `IToolResultOutputDetailsSerialized` | バイナリ出力等 |

**実装仕様:**
- `<details>/<summary>` でツールブロックを折りたたむ
- summary: ツールアイコン相当 (`🔧`) + 表示タイトル
- `isComplete: false` → summary にスピナークラスを付ける
- `resultDetails` が URI 配列 → ファイルパスのリストを表示
- `resultDetails` が入出力 → `input`/`output` を preformatted で表示

#### 代表的な toolId 一覧

| toolId | 意味 |
|--------|------|
| `copilot_findFiles` | ファイル検索 |
| `copilot_viewImage` | 画像参照 |
| `copilot_readFile` | ファイル読み込み |
| `copilot_editFile` | ファイル編集 |
| `copilot_runInTerminal` | ターミナル実行 |
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
- `ChatTextEditContentPart` で diff エディタを表示
- ファイル名 + 変更行数 をヘッダに表示
- `done: false` → "pending" 表示、`done: true` → "completed" 表示

**実装仕様:**
- ファイルパス (`uri.fsPath` または `uri.path`) を正規化して表示
- `edits` の数量を "(N edits)" として付記
- コードダイアログは初期フェーズでは省略し、ファイルパスと編集数のみ表示

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
VSCode では Markdown コードブロックのヘッダにファイルパスのリンクとして表示される。

**実装仕様:**
- 直前の Markdown パーツのコードブロックのヘッダに、`uri.fsPath` のファイル名を付記する
- `isEdit: true` の場合は編集を示すバッジを付ける

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

**表示:** Markdown テキスト内の「#ファイル参照」や `@` 参照が解決されたもの。  
直後のまたは直前の Markdown の一部として埋め込まれて使われる。

**実装仕様:**
- ファイルパスをテキストで表示 (`📄 ファイル名`)
- 独立したブロックとして表示するか、Markdown 内インラインリンクとして扱う

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

**VSCode の表示:** `ChatTaskContentPart` で折りたたみ可能なタスクブロックを表示。  
progress 配列に警告や参照が含まれる場合がある。

**実装仕様:**
- `content.value` のテキストを表示 (折りたたみ不要)
- `progress` が空でない場合は配下にリスト表示

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

**VSCode の表示:** `ChatConfirmationContentPart` で承認/拒否ボタン付きのカードを表示。  
保存済みセッションでは既に完了しているため、どの選択肢が選ばれたかの情報は別途参照する必要がある。

**実装仕様:**
- タイトルと message.value を表示する (Markdown レンダリング)
- ボタンは非活性な表示で "already confirmed" 等の表示を付ける

---

### 3.9 ユーザー入力リクエスト履歴 (`kind: "elicitationSerialized"`)

```jsonc
{
  "kind": "elicitationSerialized",
  "title": { "value": "ターミナルが入力を待機しています。", ... },
  "message": { "value": "Saved batch 2\r\nターミナルに必要な...", ... },
  "state": "accepted" | "rejected" | "pending",
  "subtitle": "",
  "isHidden": false
}
```

**VSCode の表示:** `ChatElicitationContentPart` でユーザー入力フォームを表示。  
保存済みでは `state` によって結果を示す。

**実装仕様:**
- `title.value` と `message.value` を表示
- `state: "accepted"` → ✓ 承認済み、`"rejected"` → ✗ 拒否済み

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
      ]
    }
  ],
  "allowSkip": false,
  "resolveId": "...",
  "data": { "questionId": "answer" }   // 回答済み時
}
```

**実装仕様:**
- `questions` リストを表示
- `data` に回答が含まれていればハイライト表示する

---

### 3.11 MCP サーバー起動 (`kind: "mcpServersStarting"`)

```jsonc
{
  "kind": "mcpServersStarting",
  "didStartServerIds": ["playwright", "filesystem"]
}
```

**実装仕様:**
- 軽量インジケーターとして表示: `🔌 MCP: playwright, filesystem`

---

### 3.12 アンドゥストップ (`kind: "undoStop"`)

```jsonc
{ "kind": "undoStop", "id": "UUID" }
```

**実装仕様:** 表示しない (内部マーカー)。

---

## 4. VSCode でのレンダリングパイプライン

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

VSCode 本体での対応関係 (参考):

| 処理段階 | VSCode 実装 | 本拡張の対応 |
|---------|------------|------------|
| モデル → ビューモデル変換 | `ChatViewModel` | `chatDocumentMapper.ts` |
| ターン毎のレンダリング | `ChatListItemRenderer` | `media/main.js` の renderTurn() |
| Markdown 描画 | `ChatMarkdownContentPart` + `marked` | `marked` (または `highlight.js`) |
| コードブロック | `CodeBlockPart` (Monaco Editor) | `<pre><code>` + syntax highlight |
| Thinking 折りたたみ | `ChatThinkingContentPart` | `<details>/<summary>` |
| ツール呼び出し | `ChatToolInvocationPart` | `<details>/<summary>` |
| テキスト編集 | `ChatTextEditContentPart` (diff editor) | ファイル名 + 編集数テキスト |
| 確認ダイアログ | `ChatConfirmationContentPart` | 読み取り専用カード |

---

## 5. Markdown レンダリングの詳細仕様

### 5.1 基本方針

- サードパーティライブラリ `marked` を Webview に読み込んで利用する
- セキュリティ: `DOMPurify` でサニタイズするか、`marked` の `sanitize` オプションを有効化する
- コードブロック: `highlight.js` で syntax highlight を適用する

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
<pre class="code-block" data-lang="typescript">
  <div class="code-block-header">
    <span class="code-lang">typescript</span>
    <span class="code-file-link">path/to/file.ts</span>   <!-- codeblockUri があるとき -->
  </div>
  <code class="hljs language-typescript">...</code>
</pre>
```

---

## 6. ターン表示の HTML 構造

```html
<div class="chat-session">
  <!-- セッションヘッダ (セッション詳細ビューのトップ) -->
  <div class="session-header">
    <h2 class="session-title">タイトル</h2>
    <div class="session-meta">
      <span>Created: 2025-05-31 12:00</span>
      <span>Model: GitHub Copilot</span>
    </div>
  </div>

  <!-- ターン (turns[] を順に表示) -->
  <div class="chat-turn" data-request-id="req-1">

    <!-- ユーザーメッセージ -->
    <div class="user-row">
      <div class="user-avatar">You</div>
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
      <div class="responder-avatar">Copilot</div>
      <div class="response-parts">

        <!-- Markdown パーツ -->
        <div class="response-part markdown-part">
          <!-- marked でレンダリングされた HTML -->
        </div>

        <!-- Thinking パーツ -->
        <details class="response-part thinking-part" open>
          <summary class="thinking-summary">
            <span class="thinking-icon">💭</span>
            <span class="thinking-title">Searching for image files</span>
          </summary>
          <div class="thinking-content">...</div>
        </details>

        <!-- Tool 呼び出しパーツ -->
        <details class="response-part tool-part" open>
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
| `codeblockUri` | `ViewerCodeblockUriPart` | `uri.fsPath`, `isEdit` |
| `inlineReference` | `ViewerInlineReferencePart` | `inlineReference.fsPath` |
| `progressTaskSerialized` | `ViewerProgressTaskPart` | `content.value` |
| `confirmation` | `ViewerConfirmationPart` | `title`, `message.value` |
| `elicitationSerialized` | `ViewerElicitationPart` | `title.value`, `message.value`, `state` |
| `questionCarousel` | `ViewerQuestionCarouselPart` | `questions[]`, `data` |
| `mcpServersStarting` | `ViewerMcpStartingPart` | `didStartServerIds[]` |
| `undoStop` | — | 非表示 |

### 7.3 Markdown パーツの強化

現在 `value` フィールドを平文として扱っているが、以下を追加する:
- `baseUri` を保持して相対パスの解決に使う
- `uris` マップを保持して `inlineReference` リンクを解決する

---

## 8. セキュリティ要件

1. ログ由来のすべての文字列を HTML エスケープまたはサニタイズしてから DOM に挿入する
2. Markdown は `marked` + `DOMPurify` でサニタイズする (`innerHTML` に直接渡さない)
3. URI は `file://` スキームのみ表示リンクとして扱い、クリック時は `vscode.open` コマンド経由にする
4. `isTrusted.enabledCommands` を参照して、許可リストにない `command:` URI は非活性にする

---

## 9. ターン/パーツレベルのメタデータ (追加調査より)

### 9.1 ターンレベルの追加フィールド

実データには以下のフィールドが含まれることがある。詳細ビューのメタデータ開示で参照する。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `modelId` / `selectedModel.identifier` | string | 使用モデル (例: `copilot/claude-opus-4.6`) |
| `modeInfo` | `{ id, kind }` | チャットモード (例: `{ id: "agent", kind: "agent" }`) |
| `agent.id` | string | エージェント識別子 |
| `agent.extensionId.value` | string | 拡張 ID (例: `GitHub.copilot-chat`) |
| `attempt` | number | リトライ番号 (0 から開始) |
| `shouldBeRemovedOnSend` | boolean | 次回送信時に削除されるターン |
| `isSystemInitiated` | boolean | システムが自動生成したターン |

レスポンス側では以下が含まれる場合がある:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `timeSpentWaiting` | number | ストリーミング開始前の待機時間 (ms) |
| `completionTokens` | number | 使用トークン数 |
| `elapsedMs` | number | 総応答時間 (ms) |

### 9.2 パーツレベルの安定 ID

各正規化パーツには安定した内部 ID を付与することで、折りたたみ状態の永続化や差分比較に使う。
推奨 ID 形式: `{requestId}:{partIndex}:{kind}`

### 9.3 折りたたみ状態の設定キー

上流 VSCode の設定に対応する本拡張独自の設定。

| 設定キー | 型 | デフォルト | 説明 |
|---------|----|----------|------|
| `copilotSessionViewer.detail.metadata.defaultVisibility` | `"expanded"` \| `"collapsed"` | `"expanded"` | セッションメタデータの初期表示 |
| `copilotSessionViewer.detail.thinking.defaultMode` | `"collapsed"` \| `"collapsedPreview"` | `"collapsedPreview"` | Thinking の初期表示モード |
| `copilotSessionViewer.detail.tools.collapsedMode` | `"off"` \| `"withThinking"` \| `"always"` | `"withThinking"` | ツール呼び出しの初期折りたたみ |
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

### Phase 1: 基本ターン表示 (マイルポイント)

- `ViewerResponsePart` 型の拡張 (Section 7.2)
- `chatDocumentMapper.ts` の拡張
- `media/main.js` の `renderTurn()` / `renderResponsePart()` 実装
- Markdown: `marked` + `highlight.js` 組み込み
- Thinking: `<details>` 折りたたみ
- Tool: `<details>` 折りたたみ + ファイル一覧
- Edit: ファイルパス + 編集数テキスト
- その他パーツ: テキスト表示

### Phase 2: 表示品質向上

- CSS テーマ変数の適用
- コードブロックのファイル名ヘッダ (`codeblockUri` との対応)
- 添付ファイルの pill 表示
- `elicitationSerialized` / `questionCarousel` の回答状態表示

### Phase 3: 機能追加 (将来)

- メタデータオーバーレイ (raw JSON 表示)
- 折りたたみ設定のコンフィグ化
- セッションエクスポート

---

## 10. VSCode とのレンダリング差異 (許容範囲)

| 機能 | VSCode 本体 | 本拡張 (Phase 1) |
|------|-----------|----------------|
| Markdown | `marked` + Monaco decoration | `marked` + `highlight.js` |
| コードブロック | Monaco Editor (インタラクティブ) | `<pre><code>` (読み取り専用) |
| ファイルリンク | エディタで開く | テキスト表示のみ |
| diff 表示 | Monaco Diff Editor | ファイルパス + 編集数 |
| ストリーミング | 逐次更新 | 不要 (静的表示) |
| 仮想化 | ListView 仮想スクロール | 通常スクロール |
| テーマアイコン | Codicon フォント | テキスト/絵文字代替 |
