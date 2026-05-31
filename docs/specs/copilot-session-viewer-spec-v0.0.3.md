# Copilot Session Viewer Functional Specification v0.0.3

## 概要

- Version: 0.0.3
- 種別: VS Code extension mockup
- 目的: GitHub Copilot Chat の保存済み session log を読み取り、workspace 単位の一覧と選択 session の本文ビューを提供する

## エントリーポイント

- Activity Bar container: `copilotSessionViewer`
- Sidebar view id: `copilotSessionViewer.sessionsView`
- Commands:
  - `copilotSessionViewer.refreshSessions`
  - `copilotSessionViewer.openSettings`

## データソース

scan 対象の `workspaceStorage` root は次から解決する。

1. `copilotSessionViewer.useBundledSampleData === true` の場合の `resources/workspaceStorage`
2. `copilotSessionViewer.workspaceStorageRoots`

追加 root では次の path 記法を許容する。

- `~`
- `%VAR%`
- `${env:VAR}`
- `$VAR`

存在しない root は warning として扱う。

## 初期 scan の仕様

v0.0.3 の初期 scan は workspace 単位で止める。

- 各 `workspaceStorage/<workspaceHash>` 直下で `chatSessions` を持つものを workspace とみなす
- `workspace.json` があれば display name と folder path を解決する
- 各 workspace について session file 数だけを数える
- 初期 scan 結果には session title 一覧を含めない

初期 scan の戻り値は次を持つ。

- scanned roots
- workspace count
- session count 総数
- workspace summary 一覧
- warnings
- scanned timestamp

workspace summary は次を含む。

- `workspaceHash`
- `workspaceName`
- `workspaceFolder?`
- `chatSessionsDir`
- `sessionCount`

## workspace 展開時の遅延読み込み

sidebar で workspace を展開したときだけ、その workspace 配下の session 一覧を読む。

- webview が `loadWorkspaceSessions` message を extension host に送る
- extension host は対象 `chatSessionsDir` の file list を読み、各 session の title summary を復元する
- 復元対象 file type は `.jsonl` と `.json`
- 読み込み結果は workspace 単位でメモリ cache する
- 同一 workspace の二重読み込み要求は in-flight promise で統合する

session summary の title 生成優先順:

1. `customTitle`
2. `inputState.inputText` の最初の非空行
3. file basename

## session 本文表示

session 選択時には対象 file を全文復元し、main panel の webview に表示する。

- panel は `Conversation Viewer` として開く
- turn 単位に user message と assistant response を表示する
- source path, workspace 情報, title, turn 数, created / updated 時刻を表示する

response part の初期対応:

- `markdown`
- `thinking`
- `toolInvocationSerialized`
- `textEditGroup`
- 未対応 part は `unknown`

`unknown` を含む全非 markdown part は raw JSON を展開表示できる。

## JSONL 復元

`.jsonl` は mutation log として処理する。

対応 entry kind:

- `0`: initial snapshot
- `1`: set
- `2`: array push / truncate + push
- `3`: delete 相当として `undefined` を set

復元器は次を満たす。

- 空行を無視する
- initial entry が無い log を失敗扱いにする
- array 以外への push を失敗扱いにする
- `.json` snapshot も decode できる

## cache 仕様

scan cache は `sql.js` を使った SQLite に保存する。

- 保存先: `globalStorageUri/session-cache.sqlite`
- v0.0.3 では workspace summary を保存する
- 旧 cache との互換のため、既存 `sessions` table から workspace summary を再構成する fallback を持つ

起動時の流れ:

1. cache を読む
2. cache があれば workspace summary を即時表示する
3. live scan を再実行する
4. 新しい workspace summary を cache に保存して再描画する

## Output ログ

`Output` タブに `Copilot Session Viewer` チャンネルを作成する。

出力対象:

- extension activation
- sessions view resolve
- cache load success / miss / failure
- workspace scan start / complete / failure
- workspace session list request / load complete / load failure
- session select
- session restore start / complete / failure
- warning の内容

## テスト

自動テスト:

- JSONL 復元器の unit test
- dummy JSONL fixture を使う integration test
- 環境変数指定で実 session file を読む optional integration test

代表コマンド:

- `npm run compile`
- `npm test`

## 既知の制約

- session detail の rendering は VS Code Chat UI の完全再現ではない
- markdown は生テキストに近い表示で、厳密な markdown renderer ではない
- response part はまだ一部のみ専用表示で、未対応 part は raw JSON placeholder に寄せている
- packaged VSIX には `resources/**` が含まれないため、実運用では外部 `workspaceStorage` root 設定が必要になる