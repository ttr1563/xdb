# Operations and recovery

## Local data

既定の保持対象：

```text
.data/xdb.sqlite
.data/artifacts/
design.config.json
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

- Figma未接続: `blocked_external`または`partial`。生成したplan/scriptを保持して接続後に再実行する。
- Image provider未設定: Illustration Specだけを保持し、生成完了とは表示しない。
- Validation failure: artifactをapprovedにせず`revise`とする。
- 重複実行: 将来のlive adapterは`tool_runs.idempotency_key`を必須にする。

## Rollback

Application rollbackは、互換migrationを確認した直前commitへ戻し、対応するDB/artifact snapshotを復元します。既に外部Figmaへ適用した変更はGit rollbackでは戻らないため、Figma version historyまたは記録済みnode IDsを用いて別途戻します。

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
