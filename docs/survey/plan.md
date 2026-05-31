最終形：サイドパネルからセッションを選択すると、メインパネルで該当の対話ログが表示される。表示内容はユーザー発言とアシスタント発言を中心に、thinking / tool / edit なども折りたたみで見える。VSCodeでの見た目は再現しようとしなくてよいが、機能的に必要な情報は出るようにする。
大枠から順に実装し、途中の段階でも動くものを残す。未対応の部分は raw JSON で仮表示としてよい。最初は UI の見た目より、会話の流れが読めることを優先する。

**推奨ステップ**

1. **JSONL 復元器を先に作る**
   - `kind:0/1/2/3` を適用して `ISerializableChatData` 相当へ戻す。
   - まず UI なしで、選んだ `.jsonl` から `sessionId`, `customTitle`, `requests.length`, `requests[n].message.text`, `response.length` が取れる状態にする。
   - ここが土台なので、軽い unit test を付ける価値があります。

2. **セッション一覧から本文を開けるようにする**
   - 既存の一覧 UI に「選択中セッション」を持たせる。
   - セッションをクリックしたら extension host 側で全文復元し、webview に送る。
   - セッション一覧UIはサイドパネルに表示したまま、メインパネルで選んだセッションの本文が表示されるようにする。
   - この時点では raw に近い簡易表示でよいです。

3. **メイン対話だけ表示する**
   - ユーザー発言: `request.message.text`
   - アシスタント発言: `response` 内の MarkdownString 相当、または `kind: 'markdownContent'`
   - まずは VS Code 風の細かい見た目より、会話の流れが読めることを優先します。

4. **thinking / tool / edit を「折りたたみプレースホルダ」で出す**
   - `thinking`: 「Thinking」ブロックとして中身を表示、初期は折りたたみでも可。
   - `toolInvocationSerialized`: tool 名、完了状態、タイトルだけ表示。
   - `textEditGroup`: 編集対象 URI と edit 数だけ表示。
   - ここまでで「単なる Q&A ではなく、エージェントの作業過程も見える」最低ラインになります。

5. **表示用 mapper を整理する**
   - 生の `response` part を UI に直接渡し続けると後でつらくなるので、早めに `ViewerResponsePart` に正規化します。
   - 例: `markdown`, `thinking`, `tool`, `edit`, `reference`, `unknown`
   - 未対応 kind は全部 `unknown` として raw JSON 展開できるようにしておくと、後続調査が楽です。

6. **大きいログ対策を入れる**
   - サンプルにかなり大きい `.jsonl` があるので、一覧スキャン時に全文復元しない。
   - 本文は選択時に読む。
   - raw JSON や tool 詳細は、必要になったら展開する遅延ロードに寄せる。

7. **次に専用表示を足す**
   - terminal tool: コマンド、cwd、exit code、出力
   - todoList: To Do 表示
   - resources/search/simpleToolInvocation: 種別ごとの小 UI
   - contentReferences / codeCitations
   - `chatEditingSessions` から diff / before-after 表示

最初のスプリントの到達点は、次くらいが現実的です。

- 一覧からセッションをクリックできる
- そのセッションのユーザープロンプトと assistant markdown が時系列に出る
- thinking と tool が最低限の折りたたみ行として見える
- 未対応 part は raw JSON で確認できる

この順番なら、VS Code パネルの完全再現に向かいつつ、各段階で動くものを残せます。