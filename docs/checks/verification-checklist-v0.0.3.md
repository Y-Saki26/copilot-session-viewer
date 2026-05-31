# Copilot Session Viewer Verification Checklist v0.0.3

更新日: 2026-05-31

## 目的

v0.0.3 時点の主要フローを手動で確認するためのチェックリストです。
主な確認対象は次の 3 点です。

- workspace 一覧の初期表示が軽量化されていること
- workspace 展開時にだけセッション一覧が遅延読み込みされること
- session 選択時に対話ログが復元され、Output タブにも追跡可能なログが出ること

## 前提条件

- `npm run compile` が成功している
- 必要に応じて `resources/workspaceStorage` または実環境の `workspaceStorage` を設定済み
- Extension Development Host で拡張を起動済み
- Output タブで `Copilot Session Viewer` チャンネルを選択できる

## 確認項目

### 1. 初期表示

手順:

1. Activity Bar から `Copilot Session Viewer` を開く
2. サイドバーの summary card を確認する

期待結果:

- Root 数、Workspace 数、Session 総数、Scanned 時刻が表示される
- 初期表示では workspace 単位のカードだけが見える
- workspace は折りたたみ状態で表示される
- session タイトル一覧はまだ読み込まれていない

### 2. workspace 展開時の遅延読み込み

手順:

1. 任意の workspace を展開する
2. 展開直後の表示を確認する
3. 読み込み完了後の session 一覧を確認する

期待結果:

- 展開直後に `Loading session summaries...` が表示される
- その workspace 配下の session 一覧だけが読み込まれる
- 別 workspace を開くまで、他 workspace の session 一覧は未読込のまま
- 読み込み失敗時は workspace 内に error card が表示される
- warning がある場合は workspace 単位で warning card が表示される

### 3. session detail panel

手順:

1. 遅延読み込み済みの workspace から session を 1 件選択する
2. editor 側に開く main panel を確認する

期待結果:

- `Conversation Viewer` の panel が開く
- session title、workspace 情報、source path、turn 数が表示される
- user message が本文として読める
- assistant markdown が表示される
- thinking / tool / edit / unknown part は折りたたみ block として表示される
- raw JSON を確認できる

### 4. Output タブのログ

手順:

1. Output タブを開く
2. `Copilot Session Viewer` チャンネルを選ぶ
3. 初期表示、workspace 展開、session 選択の順に操作する

期待結果:

- activation 時に `Extension activated.` が出る
- sidebar 解決時に `Sessions view resolved.` が出る
- cache 読み込み、scan 開始、scan 完了が出る
- workspace 展開時に `Workspace session list requested:` が出る
- 遅延読込完了時に `Workspace session list loaded in ...` が出る
- session 選択時に `Session selected:` が出る
- 復元開始時に `Restoring session log:` が出る
- 復元完了時に `Session restored:` が出る

## 実施済みサンプル確認

2026-05-31 に次の手順で確認を実施した。

1. `Copilot Session Viewer` を開く
2. `AtomWorkCreator` workspace を展開する
3. `プロジェクト改修提案リストアップ` session を選択する

このとき Output チャンネルで次を確認した。

- 初期 cache 読み込み成功
- full scan 完了
- `AtomWorkCreator` の session 一覧 30 件を遅延読み込み
- `プロジェクト改修提案リストアップ` の session 復元成功
- restored turn 数 1

## 補助コマンド

- compile: `npm run compile`
- decoder tests: `npm test`
