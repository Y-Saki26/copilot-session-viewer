# Copilot Session Viewer

GitHub Copilot Chat のセッションログを読み取り、表示する VS Code 拡張です。

現在の実装はモックアップ段階で、workspaceStorage 配下の chatSessions を全走査し、workspace ごとにグループ化したセッションタイトル一覧をサイドバーに表示します。

## できること

- resources/workspaceStorage のサンプルデータを既定で読み込む
- 設定から追加の workspaceStorage ルートを指定する
- JSONL と JSON のセッションファイルを走査する
- customTitle を優先し、無い場合は最初の入力文からタイトルを生成する
- workspace ごとにグループ化し、各グループとセッションを更新日時の降順で表示する

## 設定

- copilotSessionViewer.useBundledSampleData: サンプルデータを含めるか
- copilotSessionViewer.workspaceStorageRoots: 追加の workspaceStorage パス一覧

設定値では以下の書き方を使えます。

- %APPDATA%/Code/User/workspaceStorage
- ${env:APPDATA}/Code/User/workspaceStorage
- ~/.config/Code/User/workspaceStorage

Windows の実データ例:

- %APPDATA%/Code/User/workspaceStorage

WSL で拡張ホストを動かす場合の例:

- /mnt/c/Users/<user>/AppData/Roaming/Code/User/workspaceStorage

WSL から参照する場合は、Windows 側パスをマウントした実パスを設定に追加してください。

## 開発

1. npm install
2. npm run compile
3. F5 で Extension Development Host を起動

## リリースビルド

1. npm install
2. npm run package:vsix
3. ルートディレクトリに生成される copilot-session-viewer-<version>.vsix を配布用成果物として使う

ローカルにインストールする場合は、VS Code で Extensions: Install from VSIX... を実行して、生成された VSIX を選択してください。
