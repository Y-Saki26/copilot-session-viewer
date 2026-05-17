# Copilot Session Viewer

GitHub Copilot Chat のセッションログを読み取り、表示する VS Code 拡張です。

現在の実装はモックアップ段階で、workspaceStorage 配下の chatSessions を全走査し、workspace ごとにグループ化したセッションタイトル一覧をサイドバーに表示します。
起動時には前回スキャン結果を SQLite キャッシュから即時表示し、その後バックグラウンドで再スキャンして更新します。

## できること

- resources/workspaceStorage のサンプルデータを既定で読み込む
- 設定から追加の workspaceStorage ルートを指定する
- JSONL と JSON のセッションファイルを走査する
- customTitle を優先し、無い場合は最初の入力文からタイトルを生成する
- workspace ごとにグループ化し、各グループとセッションを更新日時の降順で表示する
- 全スキャン結果を globalStorageUri 配下の SQLite キャッシュに保存する

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

## テスト

`chatLogDecoder` のテストは Node.js 標準の test runner を使います。
テストコードは `out/chatLogDecoder.js` を参照するため、個別実行する場合は先に `npm run compile` を実行してください。

まとめて実行する場合:

1. npm test

`npm test` は `npm run compile` の後に、単体テストとダミーデータを使う結合テストを実行します。
実ファイル検証テストは、環境変数 `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG` が未指定なら skip されます。

### 単体テスト

`kind:0/1/2/3` の適用や異常系を確認します。

1. npm run compile
2. node --test test/chatLogDecoder.test.js

### ダミーデータでの結合テスト

`test/fixtures/dummy-session.jsonl` を実際のセッションファイルと同じ入口でデコードし、復元結果を確認します。

1. npm run compile
2. node --test test/chatLogDecoder.integration.test.js

### 実ファイルでの検証テスト

`COPILOT_SESSION_VIEWER_REAL_SESSION_LOG` に、検証したいセッションファイル、またはその親ディレクトリを指定します。
ディレクトリを指定した場合は、その配下から最初に見つかった `.jsonl` または `.json` を使います。

プレースホルダー:

1. npm run compile
2. COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=/path/to/session-or-directory node --test test/chatLogDecoder.integration.test.js

このリポジトリに同梱している `resources` のサンプルデータで試す例:

1. npm run compile
2. COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=resources/workspaceStorage/5f3aa8f0ed4fe36b9f000ed9d50e6b9b/chatSessions node --test test/chatLogDecoder.integration.test.js

実ファイル検証も含めてまとめて回したい場合は、次のように `npm test` を使えます。

1. COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=/path/to/session-or-directory npm test

## リリースビルド

1. npm install
2. npm run package:vsix
3. ルートディレクトリに生成される copilot-session-viewer-<version>.vsix を配布用成果物として使う

ローカルにインストールする場合は、VS Code で Extensions: Install from VSIX... を実行して、生成された VSIX を選択してください。
