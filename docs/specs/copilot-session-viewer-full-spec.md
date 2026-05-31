# Copilot Session Viewer Full Specification

## 文書の位置づけ

- 本書は Copilot Session Viewer の現行実装をまとめるフル仕様書です。
- リリース時は本書を最新実装に合わせて更新します。
- `copilot-session-viewer-spec-vX.Y.Z.md` は、前回リリースからの差分だけを記録するリリースノートとして扱います。
- 本書の内容は、現行コードベース、v0.0.3 実装時の作業ログ、git 履歴を基に整理しています。

## 1. 製品概要

- 拡張機能名: Copilot Session Viewer
- 現在バージョン: 0.0.3
- 種別: VS Code 拡張機能
- 目的: GitHub Copilot Chat の保存済みセッションログを読み取り、ワークスペース単位の一覧表示と、選択セッションの会話本文表示を行う
- 想定データソース: VS Code の workspaceStorage 配下に保存された Copilot Chat セッションログ

本拡張は Activity Bar 上の専用ビューからセッション一覧を表示し、選択したセッションを別のメインパネルで復元表示する。起動時は SQLite キャッシュを優先表示し、その後に live scan を実行して結果を更新する。

## 2. 提供 UI とエントリーポイント

### 2.1 Activity Bar

- views container id: `copilotSessionViewer`
- 表示タイトル: Copilot Logs
- アイコン: `media/activitybar.svg`

### 2.2 Sidebar Webview

- view id: `copilotSessionViewer.sessionsView`
- 表示名: Sessions
- 役割:
  - scan 結果のサマリー表示
  - ワークスペース一覧の表示
  - 展開時のセッション一覧遅延読み込み
  - セッション選択操作の起点

### 2.3 Session Detail Panel

- panel id: `copilotSessionViewer.sessionPanel`
- タイトル: 選択したセッションタイトルに追従
- 役割:
  - 復元済み会話本文の表示
  - ユーザー発話と応答 part の時系列表示
  - 復元中状態とエラー状態の表示

### 2.4 コマンド

- `copilotSessionViewer.refreshSessions`
  - ワークスペース一覧の再 scan を実行する
- `copilotSessionViewer.openSettings`
  - `copilotSessionViewer.workspaceStorageRoots` 設定を開く

### 2.5 Output チャンネル

- チャンネル名: Copilot Session Viewer
- 役割:
  - 拡張の起動
  - キャッシュ読込
  - scan 開始/完了/失敗
  - workspace 遅延読み込み
  - session 復元
  - warning / error
  を確認するための運用ログ出力

## 3. 設定

### 3.1 `copilotSessionViewer.workspaceStorageRoots`

- 型: string array
- 既定値: []
- 意味: 追加で scan する workspaceStorage ルート

サポートするパス表記:

- `~`
- `%VAR%`
- `${env:VAR}`
- `$VAR`

### 3.2 `copilotSessionViewer.useBundledSampleData`

- 型: boolean
- 既定値: true
- 意味: リポジトリ配下の `resources/workspaceStorage` を scan 対象へ含める

## 4. データソースと探索仕様

### 4.1 ルート解決

scan 対象 root は次の順序で組み立てる。

1. `useBundledSampleData === true` の場合、`resources/workspaceStorage`
2. `workspaceStorageRoots` に指定された各ルート

- 空文字は無視する
- 変数展開後は絶対パス化する
- 重複 root は排除する
- 存在しない root は warning として記録する

### 4.2 ワークスペース判定

各 root 直下の子ディレクトリを workspace candidate とし、その配下に `chatSessions` ディレクトリが存在する場合のみ対象とする。

workspace 情報の決定方法:

- `workspace.json` がある場合は `folder` または `workspace` を読む
- 表示名はそのパスの末尾要素を使う
- 取得できない場合は workspace hash ディレクトリ名を表示名にする

workspace summary は次を保持する。

- `workspaceHash`
- `workspaceName`
- `workspaceFolder`
- `chatSessionsDir`
- `sessionCount`

### 4.3 セッションファイル探索

`chatSessions` 配下の次のファイルを対象とする。

- `.jsonl`
- `.json`

サブディレクトリ再帰探索は行わず、`chatSessions` 直下のファイルのみ読む。

## 5. 初期読み込みと遅延読み込み

### 5.1 初期読み込み

拡張起動後、sessions view 初期化時に次の順で処理する。

1. SQLite キャッシュを読む
2. キャッシュがあれば workspace summary を即時表示する
3. live scan を実行する
4. 新しい scan 結果をキャッシュへ保存する
5. sidebar を live 結果で再描画する

初期 scan では session 本文や session title 一覧は読まず、workspace 単位の summary のみを作る。これにより、大量の session file を持つ workspace でも初期表示コストを抑える。

### 5.2 sidebar の展開時遅延読み込み

sidebar の各 workspace は折りたたみ表示される。workspace を展開したときだけ、その workspace 配下の session 一覧を読み込む。

- Webview は `loadWorkspaceSessions` メッセージを送る
- extension host は `chatSessionsDir` 単位で session file を列挙する
- 各 file から title summary を復元する
- 結果はメモリ cache に保持する
- 同一 workspace への重複要求は in-flight promise で統合する

workspace を再展開したとき、同一セッション一覧が既にメモリ上にあれば再利用する。

## 6. スキャン結果とキャッシュ仕様

### 6.1 ScanSummary

scan 結果は次を持つ。

- `rootsScanned`
- `workspaceCount`
- `sessionCount`
- `workspaces`
- `warnings`
- `scannedAt`
- `loadedFromCache`

### 6.2 workspace の並び順

- `workspaceName` 昇順
- 同名時は `chatSessionsDir` 昇順

### 6.3 session 一覧の並び順

- `updatedAt` 降順
- 同時刻時は `title` 昇順

### 6.4 SQLite キャッシュ

- 実装: `sql.js`
- 保存先: `globalStorageUri/session-cache.sqlite`
- スキーマ:
  - `metadata`
  - `roots`
  - `warnings`
  - `workspaces`
  - `sessions`

現行保存の主体は `workspaces` テーブルである。旧キャッシュ互換のため、`workspaces` が空でも `sessions` テーブルから workspace summary を再構成できる。

保存時は全削除後の再投入を行う。失敗時は rollback する。

## 7. セッション summary 復元仕様

session summary は session file ごとに生成する。

保持項目:

- `id`
- `title`
- `workspaceHash`
- `workspaceName`
- `workspaceFolder`
- `sourcePath`
- `createdAt`
- `updatedAt`

### 7.1 `.json` の summary 復元

使用する主なフィールド:

- `sessionId`
- `customTitle`
- `creationDate`
- `inputState.inputText`

### 7.2 `.jsonl` の summary 復元

summary 用の軽量パースでは、各行を順に読み次を拾う。

- `kind === 0`
  - `sessionId`
  - `customTitle`
  - `creationDate`
  - `inputState.inputText`
- `kind === 1`
  - `customTitle`
  - `inputState.inputText`

破損した 1 行があっても全体 scan は止めず warning として継続する。

### 7.3 title 決定順

1. `customTitle`
2. `inputText` の最初の非空行
3. セッションファイル名

`inputText` 由来の title は 50 文字超過時に省略する。

## 8. JSONL 全文復元仕様

session detail 表示時は軽量 summary ではなく、session file 全体を復元する。

### 8.1 対応形式

- `.jsonl`
- `.json`

### 8.2 `.jsonl` mutation log の対応 kind

- `0`: initial snapshot
- `1`: set
- `2`: array push または truncate + push
- `3`: delete 相当。対象 path に `undefined` を set する

### 8.3 復元器の動作

- 空行は無視する
- 初期 entry が無い場合は失敗にする
- root 以外の push で対象が配列でない場合は失敗にする
- 不正 path や不正 payload は失敗にする
- `.json` は object snapshot としてそのまま decode する

### 8.4 decode 結果

主に次の情報を保持する。

- `sessionId`
- `creationDate`
- `customTitle`
- `responderUsername`
- `inputState`
- `requests`
- `pendingRequests`

## 9. 詳細表示用マッピング仕様

全文復元した session data は UI に直接渡さず、表示用の `ChatSessionDocument` に正規化する。

### 9.1 ChatSessionDocument

- `id`
- `title`
- `workspaceHash`
- `workspaceName`
- `workspaceFolder`
- `sourcePath`
- `createdAt`
- `updatedAt`
- `responderUsername`
- `turns`

### 9.2 turn の構成

各 turn は request 単位で作る。

- `requestId`
- `timestamp`
- `userText`
- `responseParts`

`userText` は次の順で抽出する。

1. `message.text`
2. `message.parts` に含まれる text value 群の結合
3. 無い場合は固定文言

### 9.3 response part の対応種類

- `markdown`
- `thinking`
- `tool`
- `edit`
- `unknown`

#### markdown

- 文字列 part、または `kind` を持たず `value` に文字列を持つ object を markdown として扱う

#### thinking

- `kind === thinking`
- 表示項目:
  - title
  - text
  - done
- `metadata.vscodeReasoningDone === true` で完了扱いにする

#### tool

- `kind === toolInvocationSerialized`
- 表示項目:
  - title
  - `toolId`
  - status
- status 判定:
  - `isConfirmed.type === 0` なら denied
  - それ以外で `isComplete === true` なら completed
  - それ以外は running

#### edit

- `kind === textEditGroup`
- 表示項目:
  - summary
  - `uri`

#### unknown

- 未対応 kind、または解釈不能な part を raw 表示用として保持する

すべての非 markdown part は raw JSON 文字列を保持し、UI で展開表示できる。

## 10. Sidebar UI 仕様

### 10.1 header

- Refresh ボタン
- Settings ボタン

### 10.2 summary 表示

表示する metric:

- Source
- Roots
- Workspaces
- Sessions
- Scanned

加えて、scan 対象 roots の一覧を表示する。

### 10.3 warnings 表示

- scan warning がある場合、専用カードに message と location を表示する
- workspace 遅延読込時の warning は、その workspace セクション内に表示する

### 10.4 workspace 表示

- 各 workspace を `<details>` ベースの折りたたみ UI で表示する
- 初期状態は折りたたみ
- 展開中のみ session 一覧を表示する
- 件数表示は summary の `sessionCount`
- 選択中 session は強調表示する

### 10.5 state 保持

Webview state に次のみ保持する。

- `selectedSessionPath`

workspace の開閉状態はランタイム state として管理されるが、現行実装では永続化していない。

## 11. Session Detail UI 仕様

### 11.1 初期状態

- セッション未選択時は案内文を表示する

### 11.2 loading 状態

- `Restoring session log...` を表示する

### 11.3 error 状態

- セッションタイトルとエラーメッセージを表示する

### 11.4 document 状態

上部 summary に次を表示する。

- Workspace
- Turns
- Created
- Updated
- Responder
- Session title
- Workspace path
- Source path

本文は turn ごとに表示する。

- Turn 番号
- request timestamp
- User message
- Assistant response parts

response part ごとの表示:

- markdown: 通常メッセージカード
- thinking/tool/edit/unknown: detail card
- raw JSON は折りたたみで表示

markdown は現状プレーンテキストに近い multiline 表示であり、専用 markdown renderer は未実装である。

## 12. 拡張ホストと Webview のメッセージ仕様

### 12.1 sidebar Webview から extension host

- `ready`
- `refresh`
- `openSettings`
- `loadWorkspaceSessions`
- `selectSession`

### 12.2 extension host から sidebar Webview

- `scanResult`
- `scanError`
- `workspaceSessionsLoaded`
- `workspaceSessionsError`

### 12.3 detail panel Webview から extension host

- `ready`

### 12.4 extension host から detail panel Webview

- `sessionDocumentLoading`
- `sessionDocument`
- `sessionDocumentError`

## 13. ログ出力仕様

Output チャンネルには ISO8601 timestamp と level を付けて 1 行ずつ出力する。

level:

- `info`
- `warn`
- `error`

主な出力イベント:

- Extension activated
- Sessions view resolved
- Sessions webview is ready
- Loading cached scan result
- Cached scan loaded / not found
- Starting workspace scan
- Workspace scan completed / failed
- Workspace session list requested / loaded / failed / served from memory cache
- Session selected
- Restoring session log
- Session restored / failed
- 各 warning の詳細

## 14. テスト仕様

### 14.1 unit test

対象:

- JSONL 復元器

確認内容:

- `kind 0/1/2/3` の適用
- 初期 entry 欠落
- 配列以外への push
- JSON snapshot decode

### 14.2 integration test

対象:

- ダミー JSONL fixture
- 実ファイル指定の任意検証

確認内容:

- dummy fixture が本番 decode 経路で読めること
- 環境変数 `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG` で指定されたファイルまたはディレクトリ配下の最初の session log を decode できること

### 14.3 主要コマンド

- `npm run compile`
- `npm test`

## 15. 配布と同梱物の注意点

- VSIX 生成は `npm run package:vsix`
- `resources/**` は VSIX から除外される
- そのため packaged extension では bundled sample data を前提にできない
- 実運用では `workspaceStorageRoots` の設定が必要になる

## 16. 既知の制約

- GitHub Copilot Chat の UI 完全再現はしていない
- markdown 専用 renderer は未実装
- response part の専用表示は一部種類のみ
- `chatSessions` 直下以外の再帰 scan は行わない
- scan cache は検索 index ではなく最後の scan snapshot
- 初期表示高速化のため、session 一覧と本文は遅延読み込みに依存する

## 17. v0.0.3 時点の主要モジュール

- `src/extension.ts`: 拡張起動、provider と command 登録、logger 初期化
- `src/viewProvider.ts`: sidebar Webview、cache / scan / 遅延読み込み / session 選択の調停
- `src/logScanner.ts`: root 解決、workspace 検出、summary scan、session summary 復元
- `src/chatLogDecoder.ts`: `.jsonl` mutation log と `.json` snapshot の全文 decode
- `src/chatDocumentMapper.ts`: 復元済みデータから detail 表示用 document への変換
- `src/sessionPanel.ts`: main panel Webview の生成と状態反映
- `src/scanCacheRepository.ts`: SQLite cache の load / save
- `src/outputLogger.ts`: Output チャンネルへのログ出力
- `media/main.js`: sidebar / detail panel の描画とメッセージ通信
- `media/styles.css`: Webview スタイル

## 18. 更新運用

- 新しいリリースを作るたびに、本書をその時点の実装へ更新する
- リリース差分は `copilot-session-viewer-spec-vX.Y.Z.md` に追記または新規作成する
- 差分仕様には、前回リリースからの追加・変更・運用上の確認事項だけを書く