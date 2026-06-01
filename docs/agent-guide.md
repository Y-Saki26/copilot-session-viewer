# Agent Guide

この文書は、Copilot Session Viewer を扱う Copilot / AI エージェント向けの共有資料です。`.github/copilot-instructions.md` には常時読み込ませたい短い方針だけを置き、詳しい構成や作業手順はこのファイルに集約します。

## 目的

Copilot Session Viewer は、GitHub Copilot Chat のセッションログを読み取り、VS Code の Activity Bar 内 Webview に一覧表示する VS Code 拡張です。

現状はモックアップ段階です。`workspaceStorage` 配下の `chatSessions` を走査し、ワークスペースごとにセッションタイトルをまとめて表示します。起動時は SQLite キャッシュを即時表示し、その後バックグラウンドで再スキャンします。

## 主要構成

- `package.json`: VS Code 拡張の manifest、コマンド、ビュー、設定、npm scripts、依存関係。
- `tsconfig.json`: TypeScript 設定。`strict: true`, `module: commonjs`, `target: ES2022`, `rootDir: src`, `outDir: out`。
- `src/extension.ts`: 拡張の activation entrypoint。Webview provider とコマンドを登録する。
- `src/viewProvider.ts`: VS Code Webview の HTML 生成、メッセージ処理、スキャン/キャッシュ読み込みの調停。
- `src/workspaceStorageRoots.ts`: OS ごとの既定 `workspaceStorage` ルートと開発用 override の解決。
- `src/logScanner.ts`: `workspaceStorage` ルート解決、`chatSessions` 探索、JSONL/JSON セッションファイル解析。
- `src/scanCacheRepository.ts`: `sql.js` を使った `globalStorageUri/session-cache.sqlite` の読み書き。
- `src/types.ts`: スキャン結果、セッション、警告の共有型。
- `media/main.js`: Webview 内の表示ロジック。VS Code API への postMessage と DOM 更新を担当する。
- `media/styles.css`: Webview のスタイル。VS Code theme variable を使う。
- `.vscode/launch.json`: Extension Development Host 起動設定。
- `.vscode/tasks.json`: `npm: compile` タスク。
- `resources/`: 参照用の大きな外部プロジェクトツリー。通常の実装対象ではない。

## 変更対象の判断

通常の機能追加や修正では、まず以下を変更対象にします。

- 拡張のライフサイクルやコマンド: `src/extension.ts`
- スキャン対象やパース仕様: `src/logScanner.ts`, `src/types.ts`
- キャッシュ構造や保存/復元: `src/scanCacheRepository.ts`, `src/types.ts`
- Webview 表示/操作: `src/viewProvider.ts`, `media/main.js`, `media/styles.css`
- 設定項目や VS Code contribution: `package.json`
- 利用者向け説明: `README.md`
- エージェント向け説明: `.github/copilot-instructions.md`, `docs/agent-guide.md`

`resources/` は参照データまたは upstream 調査用として扱います。ユーザーが明示しない限り、`resources/vscode` や `resources/vscode-copilot-chat` 内のファイルは編集しないでください。探索時も検索対象を絞り、必要なら `rg --glob '!resources/**'` のように除外してください。

## 実装メモ

### スキャン

`CopilotSessionScanner.scan()` は次の順序で処理します。

1. `copilotSessionViewer.workspaceStorageRoots` から候補ルートを作る。空の場合は OS ごとの既定 root を使う。F5 デバッグ起動では `.vscode/launch.json` の `COPILOT_SESSION_VIEWER_WORKSPACE_STORAGE_ROOTS` が優先される。
2. 存在しないルートは `warnings` に積む。
3. 各ルート直下のワークスペースディレクトリから `chatSessions` を探す。
4. `workspace.json` があれば `folder` または `workspace` から表示名とパスを作る。
5. `chatSessions` 内の `.jsonl` と `.json` を解析する。
6. `updatedAt` 降順、同一時刻は `title` 昇順で返す。

`resources/workspaceStorage` は F5 デバッグ起動と実ファイル検証テスト用のサンプルデータです。`.vscodeignore` により VSIX から除外されるため、配布版の実行時データとしては扱わないでください。

### セッションファイル

- JSON snapshot は `sessionId`, `customTitle`, `creationDate`, `inputState.inputText` を見る。
- JSONL は `kind === 0` の初期状態と、`kind === 1` の `customTitle` / `inputState.inputText` 更新を読む。
- タイトルは `customTitle` を優先し、なければ最初の入力行を 50 文字以内に切り詰める。さらに無ければファイル名を使う。
- パース失敗は全体を止めず `warnings` に積む設計。

### キャッシュ

`ScanCacheRepository` は `sql.js` を遅延初期化し、VS Code の `context.globalStorageUri.fsPath` に `session-cache.sqlite` を保存します。スキーマは `metadata`, `roots`, `warnings`, `sessions` の 4 テーブルです。

保存は `BEGIN` から全削除/再投入し、失敗時は `ROLLBACK` します。スキーマ変更時は読み込み互換性と既存キャッシュの扱いを明記してください。

### Webview

`viewProvider.ts` は CSP nonce を生成し、`media/main.js` と `media/styles.css` だけを読み込ませます。外部 script や inline script は追加しないでください。

`media/main.js` はユーザー入力由来の文字列を `escapeHtml` してから `innerHTML` に渡しています。新しい表示項目を追加する場合も、セッションタイトル、パス、警告などログ由来の値は必ずエスケープしてください。

Webview と拡張ホストの通信は現在 `ready`, `refresh`, `openSettings`, `scanResult`, `scanError` です。メッセージ型を増やす場合は、`viewProvider.ts` と `media/main.js` の両方を更新してください。

## 開発コマンド

初回セットアップ:

```powershell
npm install
```

ビルド:

```powershell
npm run compile
```

開発起動:

```text
VS Code で F5 を押し、Extension Development Host を起動する。
```

VSIX パッケージ:

```powershell
npm run package:vsix
```

`package:vsix` は `vsce package --allow-missing-repository` を実行し、事前に `npm run compile` が走ります。

## 検証方針

- TypeScript や manifest を変更したら `npm run compile` を実行する。
- `package.json` の contribution、activation、設定、配布に関わる変更では Extension Development Host で起動確認する。
- Webview 表示を変更したら、空状態、警告あり、複数 workspace、長いパス/タイトルの表示崩れを確認する。
- スキャン/パース処理を変更したら、JSONL と JSON の両方、壊れた JSONL 行、存在しないルートの warning を確認する。
- キャッシュ処理を変更したら、初回 live scan と再起動後の cache load の両方を確認する。

現時点で npm scripts に自動テストや lint は定義されていません。テスト追加の依頼がない限り、既存の検証入口は `npm run compile` と Extension Development Host での手動確認です。

## コーディング規約

- TypeScript は `strict` を維持する。
- 既存の import 形式、class 構成、明示的な戻り値型に合わせる。
- `any` を増やさない。外部 JSON を読む箇所では `unknown` と小さな型ガードを優先する。
- ファイルシステムアクセスは `fs/promises` と `path` を使う。
- エラーはユーザーに必要な情報を `ScanWarning` または VS Code error message として返し、単一ファイルの失敗で全スキャンを止めない。
- UI 文字列は現状英語中心、README と docs は日本語中心。既存の表示言語に合わせて更新する。
- VS Code theme variable を使い、固定色だけに依存しない。

## Copilot カスタム指示の運用

GitHub のリポジトリ向けカスタム指示は `.github/copilot-instructions.md` に置きます。パス別の補足が必要になった場合は `.github/instructions/NAME.instructions.md` を作り、frontmatter の `applyTo` に対象 glob を書きます。

このリポジトリでは常時適用の入口を `.github/copilot-instructions.md` に寄せます。`AGENTS.md` は併用せず、Copilot 以外のエージェントも `docs/agent-guide.md` を直接参照してください。将来 `AGENTS.md` に移す場合は、入口を一つに保つため `.github/copilot-instructions.md` との役割重複を整理してください。

常時読み込む `.github/copilot-instructions.md` は短く保ち、長い説明、調査結果、設計判断、検証手順はこの `docs/agent-guide.md` に移してください。これにより Copilot 以外のエージェントも同じ資料を参照できます。

`.github/instructions/*.instructions.md` を追加する場合は、一つのファイルに一つの関心事だけを書き、`description` は `Use when ...` 形式で具体的なトリガー語を含めてください。`applyTo: "**"` は常時読み込みに近くなるため、対象が全ファイルに本当に必要な場合だけ使ってください。

## 参考にした資料

- GitHub Docs: Adding repository custom instructions for GitHub Copilot
- GitHub Copilot Chat extension の `create-instructions` skill
- GitHub Copilot Chat extension の `agent-customization` skill
