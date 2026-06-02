# Copilot Session Viewer

GitHub Copilot Chat のセッションログを読み取り、表示する VS Code 拡張です。

VS Code ユーザーストレージ配下の workspaceStorage と globalStorage を走査し、保存先ごとにグループ化したセッションタイトル一覧をサイドバーに表示します。
起動時には前回スキャン結果を SQLite キャッシュから即時表示し、その後バックグラウンドで再スキャンして更新します。

## できること

- OS ごとの既定 VS Code ユーザーストレージルートを読み込む
- workspaceStorage 配下のワークスペース別ログを走査する
- globalStorage/emptyWindowChatSessions 配下の空ウィンドウログを走査する
- 設定から VS Code ユーザーストレージルートを上書きする
- サンプルデータ向けに workspaceStorage ルートを直接追加する
- JSONL と JSON のセッションファイルを走査する
- customTitle を優先し、無い場合は最初の入力文からタイトルを生成する
- 保存先ごとにグループ化し、各グループとセッションを更新日時の降順で表示する
- 空セッションは既定で隠し、サイドバーのチェックボックスで表示を切り替える
- 全スキャン結果を globalStorageUri 配下の SQLite キャッシュに保存する

## 設定

- `copilotSessionViewer.vscodeUserStorageRoots`: 走査する VS Code ユーザーストレージパス一覧
- `copilotSessionViewer.workspaceStorageRoots`: 追加で直接走査する workspaceStorage パス一覧

`vscodeUserStorageRoots` が空の場合は、OS に応じて以下の既定値を使います。

- Windows: `%APPDATA%\Code\User`
- UNIX 系: `~/.config/Code/User`

設定値では以下の書き方を使えます。

- `%APPDATA%\Code\User`
- `${env:APPDATA}\Code\User`
- `~/.config/Code/User`

通常の走査では各ユーザーストレージルート配下の `workspaceStorage/*/chatSessions` と
`globalStorage/emptyWindowChatSessions` を対象にします。`workspaceStorageRoots` は
`resources/workspaceStorage` のようなデバッグ用サンプルデータを直接指定するときに使います。
