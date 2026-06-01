# Copilot Repository Instructions

このリポジトリで作業する Copilot / AI エージェントは、最初に [docs/agent-guide.md](../docs/agent-guide.md) を読んでください。

## 基本方針

- 主要な実装対象は `src/`, `media/`, `package.json`, `README.md`, `.vscode/` です。
- `resources/` は VS Code / vscode-copilot-chat の大きな参照ツリーです。ユーザーが明示しない限り編集対象にしないでください。
- 変更前に `README.md`, `package.json`, `tsconfig.json`, 関連する `src/*.ts`, `media/*` を確認し、既存の小さな構成に沿ってください。
- TypeScript は `strict` 前提です。`any` の追加、型エラーの抑制、不要な抽象化は避けてください。
- Webview は VS Code Webview の制約を守り、HTML は `viewProvider.ts`、表示ロジックは `media/main.js`、スタイルは `media/styles.css` に分けてください。
- 検証は少なくとも `npm run compile` を実行してください。VSIX 配布に関わる変更では `npm run package:vsix` も確認してください。

## 参照資料

- 開発時のガイドライン、テスト手順、リリースビルドの方法: [docs/development-guide.md](../docs/development-guide.md)
- 詳細なプロジェクト構成、実装メモ、検証手順: [docs/agent-guide.md](../docs/agent-guide.md)
- ユーザー向け概要: [README.md](../README.md)
