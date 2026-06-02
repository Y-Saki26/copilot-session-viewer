# 開発ガイド

開発者向けのガイドです。

## 必要環境

- Node.js 20.18.1 以上

## 開発

1. npm install
2. npm run compile
3. F5 で Extension Development Host を起動

`.vscode/launch.json` は、F5 で起動した Extension Development Host に限り `COPILOT_SESSION_VIEWER_WORKSPACE_STORAGE_ROOTS` を設定します。これにより開発時は `resources/workspaceStorage` のサンプルデータだけを走査します。この環境変数は VSIX に含まれず、通常のインストール版では OS ごとの既定 VS Code ユーザーストレージ root または `copilotSessionViewer.vscodeUserStorageRoots` 設定を使います。追加サンプルを通常設定から読む場合は `copilotSessionViewer.workspaceStorageRoots` に直接指定します。

## テスト

TypeScript の単体テストと結合テストは Vitest を使います。
テストコードは `src/*.ts` を直接参照し、`npm run test:typecheck` で strict 型検査も行います。

まとめて実行する場合:

1. npm test

`npm test` は compile、TypeScript テストの型検査、Vitest の順に実行します。
実ファイル検証テストは、環境変数 `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG` が未指定なら skip されます。

Vitest だけを実行する場合:

1. `npm run test:vitest`

watch mode で実行する場合:

1. `npm run test:watch`

### 単体テスト

`kind:0/1/2/3` の適用や異常系を確認します。

1. `npm run test:vitest -- test/chatLogDecoder.test.ts`

### ダミーデータでの結合テスト

`test/fixtures/dummy-session.jsonl` を実際のセッションファイルと同じ入口でデコードし、復元結果を確認します。

1. `npm run test:vitest -- test/chatLogDecoder.integration.test.ts`

### 実ファイルでの検証テスト

`COPILOT_SESSION_VIEWER_REAL_SESSION_LOG` に、検証したいセッションファイル、またはその親ディレクトリを指定します。
ディレクトリを指定した場合は、その配下から最初に見つかった `.jsonl` または `.json` を使います。

プレースホルダー:

1. `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=/path/to/session-or-directory npm run test:vitest -- test/chatLogDecoder.integration.test.ts`

このリポジトリに同梱している `resources` のサンプルデータで試す例:

1. `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=resources/workspaceStorage/5f3aa8f0ed4fe36b9f000ed9d50e6b9b/chatSessions npm run test:vitest -- test/chatLogDecoder.integration.test.ts`

実ファイル検証も含めてまとめて回したい場合は、次のように `npm test` を使えます。

1. `COPILOT_SESSION_VIEWER_REAL_SESSION_LOG=/path/to/session-or-directory npm test`

## リリースビルド

1. `npm install`
2. `npm run package:vsix`
3. ルートディレクトリに生成される `copilot-session-viewer-<version>.vsix` を配布用成果物として使う

ローカルにインストールする場合は、VS Code で Extensions: Install from VSIX... を実行して、生成された VSIX を選択してください。

`resources/**`、`test/**`、Vitest 設定は VSIX から除外されるため、サンプルログ、ローカルデータ、テスト資産は配布物に含まれません。
