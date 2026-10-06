# トラブルシューティング

## `npm install`または起動時にNode.js versionを指摘される

XDBはNode.js 24以上を要求します。

```console
node --version
npm --version
```

Node.jsを更新後、repositoryで再度`npm install`を実行してください。

## Web UIが開かない

開発モードではUIとAPIのportが異なります。

- UI: `http://127.0.0.1:4311`
- API: `http://127.0.0.1:4310`

APIを確認します。

```console
curl http://127.0.0.1:4310/api/health
```

portが使用中なら、`.env`の`XDB_PORT`を空いている1〜65535のportへ変更します。UI側のdevelopment proxy設定も4310を前提としているため、API portを変更する場合はcode側設定との整合確認が必要です。

## production形式で画面が表示されない

`npm start`の前にbuildが必要です。

```console
npm run build
npm start
```

build済み構成のURLは`http://127.0.0.1:4310`です。

## MCP clientにXDBが表示されない

1. `npm install`済みか確認する。
2. commandとentrypointが実在する絶対pathか確認する。
3. `codex mcp get xdb`または利用clientの接続確認を実行する。
4. MCP登録後に新しいAI sessionを開始する。
5. XDB repositoryを移動した場合は登録pathを更新する。

XDBはstdio MCPです。remote HTTP MCP URLとして登録しないでください。

## `request_research_pending`でPlanを作れない

Requestに`pending`または`analyzed`の参考URLがあります。

1. `xdb_list_request_references`または`GET /api/request-references?requestId=...`で確認する。
2. 未調査URLは許可されたclientで分析する。
3. 人間が内容を確認する。
4. `approved | rejected | unavailable`のいずれかを理由付きで確定する。
5. 全件がfinalになってからPlanを再実行する。

参照を無視して自動的にPlanningを進めるfallbackはありません。

## Claudeを選んでもLocal Planになる

UIの`GET /api/config`表示またはAI run履歴でblock reasonを確認します。主な理由は次のとおりです。

- API keyまたはmodel IDが未設定
- `allowExternalRequests: false`
- `monthlyTokenBudget: 0`または残量不足
- base URLがallowlistと一致しない
- timeout、rate limit、upstream error、不正tool result

fallbackが許可されている場合はLocal Planを作り、Claude生成とは記録しません。設定方法は[Claude provider](../skills/xdb-design-intelligence/references/claude-provider.md)を参照してください。

## Figma runが`partial`または`blocked_external`になる

次を確認します。

- Figma接続がある
- 対象fileへのwrite権限がある
- 既存file keyを指定した
- desktop/mobile rootが各1件で同じpageにある
- clipped textとplaceholder textが0
- node IDとscreenshot確認をdeliveryへ記録した

operation planを生成しただけではFigma write完了ではありません。詳細は[Figma delivery](../skills/xdb-design-intelligence/references/figma-delivery.md)を参照してください。

## write toolが`operation_outcome_unknown`になる

process停止などにより、domain writeの成否を安全に判断できない状態です。同じkeyや別keyで直ちに再実行しないでください。

1. Request、Plan、Run、Evaluationの一覧を取得する。
2. artifact pathとSHA-256を確認する。
3. Figma操作ならfileと記録済みnodeを確認する。
4. 副作用が存在しないと確認できた場合だけ、新しいkeyで明示的に実行する。

## starter packのimport件数が12件より少ない

既に同じmetadata fingerprintのKnowledgeがある場合はduplicateとして作成されません。Researchのimport batchで`createdCount`、`duplicateCount`、`rejectedCount`と行別errorを確認してください。

## データを初期化したい

`.data/xdb.sqlite`と`.data/artifacts/`は利用データです。削除は復元不能なので、XDBを停止し、必要なbackupを取得してから対象を明示してください。Git操作だけではこれらのデータは戻りません。

