# Copilot Session Viewer

GitHub Copilot Chat のセッションログを読み取り、表示する VS Code 拡張です。

workspaceStorage 配下の chatSessions を全走査し、workspace ごとにグループ化したセッションタイトル一覧をサイドバーに表示します。
起動時には前回スキャン結果を SQLite キャッシュから即時表示し、その後バックグラウンドで再スキャンして更新します。

## できること

- OS ごとの既定 workspaceStorage ルートを読み込む
- 設定から workspaceStorage ルートを上書きする
- JSONL と JSON のセッションファイルを走査する
- customTitle を優先し、無い場合は最初の入力文からタイトルを生成する
- workspace ごとにグループ化し、各グループとセッションを更新日時の降順で表示する
- 空セッションは既定で隠し、サイドバーのチェックボックスで表示を切り替える
- 全スキャン結果を globalStorageUri 配下の SQLite キャッシュに保存する

## 設定

- `copilotSessionViewer.workspaceStorageRoots`: 走査する workspaceStorage パス一覧

設定が空の場合は、OS に応じて以下の既定値を使います。

- Windows: `%APPDATA%/Code/User/workspaceStorage`
- UNIX 系: `~/.config/Code/User/workspaceStorage`

設定値では以下の書き方を使えます。

- `%APPDATA%/Code/User/workspaceStorage`
- `${env:APPDATA}/Code/User/workspaceStorage`
- `~/.config/Code/User/workspaceStorage`
