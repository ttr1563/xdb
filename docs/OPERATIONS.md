# Operations and recovery

## Local data

既定の保持対象：

```text
.data/xdb.sqlite
.data/artifacts/
design.config.json
.mcp.json
```

`.data/`はGit管理しません。運用データを保持する場合は、SQLiteとartifactsを同じ時点でbackupしてください。

## Backup

APIを停止した状態でSQLiteとartifactsをversion付きdirectoryへcopyします。稼働中backupを実装する場合はSQLite backup APIまたは整合したsnapshotを使用し、DBだけ／artifactだけを個別に戻さないでください。

## Restore validation

1. 復元先を別directoryに用意する。
2. `XDB_DATABASE_PATH`と`XDB_ARTIFACTS_PATH`を復元先へ向ける。
3. `GET /api/health`と`GET /api/export`を確認する。
4. artifact SHA-256と実fileを照合する。
5. HTML previewと少なくとも一件のrequest → plan → runを確認する。

## Adapter failure

- Claude外部実行OFF・未接続・予算不足・timeout・不正出力: `ai_runs`へerror codeと試行回数を記録し、設定で許可されている場合だけlocal plannerへfallbackする。fallbackしたPlanをClaude生成と表示しない。
- Claude 429・5xx: `maxRetries`回だけexponential backoff後にretryする。timeout、4xx（429以外）、schema不正、network errorは自動retryしない。
- Figma未接続: `blocked_external`または`partial`。生成したplan/scriptを保持して接続後に明示実行する。
- Figma外部write: 安定した`operationKey`とroot名で対象fileを先に検査する。desktop/mobileの一方だけが存在する場合や実行結果が不明な場合は自動retryせず、node IDとerrorをpartial/failed deliveryとして記録する。
- Figma完了判定: 両rootのnode ID、created/mutated node ID、構造監査、desktop/mobile screenshot確認が揃い、clipped textとplaceholder textが0の場合だけ`completed`を記録する。同一operationの同一payloadはreplayできるが、異なる証跡や二重完了は拒否する。
- Image provider未設定: Illustration Specだけを保持し、生成完了とは表示しない。
- Validation failure: artifactをapprovedにせず`revise`とする。
- Figma deliveryの重複実行: `operationKey`とpayloadを照合し、同一証跡だけをreplayする。別payloadへのkey再利用と、別operationによる二重完了は409で拒否する。
- MCP writeの重複実行: `mcp_operations`のkeyとrequest hashでreplay／conflictを判定する。owner tokenでlease更新とterminal transitionをfenceする。完了済み結果だけをreplayし、running、期限切れ、failedのkeyではdomain処理を自動再実行しない。
- MCP writeの結果不明: process停止等でleaseが期限切れになった操作は`operation_outcome_unknown`とする。Request、Plan、Run、評価の保存状態とartifactを照合し、副作用がないと確認できた場合だけ新しいkeyで実行する。
- MCP process停止: stdio child processだけが停止し、HTTP API・UI・SQLiteの保存データは継続利用できる。

## Rollback

Application rollbackは、互換migrationを確認した直前commitへ戻し、対応するDB/artifact snapshotを復元します。既に外部Figmaへ適用した変更はGit rollbackでは戻らないため、記録済みfile/root/node IDを照合し、Figma version historyから対象fileを復元します。version historyを確認できない場合はnodeを削除・上書きせず、復旧判断を止めます。

## Anthropic model lifecycle

1. Anthropic account側で現在利用可能なmodel ID、単価、retirement日を確認する。
2. `allowExternalRequests: false`のまま`.env`の`XDB_ANTHROPIC_MODEL`だけを更新する。
3. mock testとLocal workflowを検証し、request token上限と月次token／費用上限を再計算する。
4. ユーザー確認後に`monthlyTokenBudget`と`allowExternalRequests` を有効化し、1 requestだけlive testする。
5. UIまたは`GET /api/ai-runs`でmodel、token、latency、statusを確認し、異常時はゲートをOFFに戻す。model IDはDB履歴に残るため過去実行は変更しない。

## Production gate

このrepositoryはlocal-onlyです。公開前に別タスクで次を確認します。

- authentication／authorization
- rate limitとrequest size limit
- TLS、Basic認証またはIP制限、robots noindex
- backup／restore test
- structured logging、監視、通知
- secret manager
- reference assetの権利と削除手順
- Figma／画像providerの費用上限と停止条件
- Anthropic model、月次／request単位のtoken・費用上限、timeout、fallback停止条件
