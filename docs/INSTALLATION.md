# インストールガイド

この文書は、XDBを自分のPCまたは開発サーバーへ導入し、Web UI、API、MCP serverをローカルで利用できる状態にする手順です。外部公開や本番デプロイの手順ではありません。

現在、Node.js 24を使ったAmazon Linux上のtypecheck、API／MCP test、client／server buildを確認しています。macOSとWindows向けに同等の標準commandを記載していますが、各OSでの実機smokeは未確認です。

## 1. 必要環境

- Git
- Node.js 24以上
- npm
- SQLiteやdatabase serverの個別インストールは不要

確認します。

```console
git --version
node --version
npm --version
```

`node --version`が`v24`以上でない場合は、Node.js公式配布または利用中のversion managerで更新してください。

## 2. repositoryを取得する

HTTPSの場合：

```console
git clone https://github.com/ttr1563/xdb.git
cd xdb
```

SSH keyをGitHubへ登録済みの場合：

```console
git clone git@github.com:ttr1563/xdb.git
cd xdb
```

`main`は公開可能なreleaseだけ、`develop`は次回release候補です。初回release前に開発版を検証する場合は`git switch develop`を実行します。release後の通常利用では`main`または明示されたrelease tagを使用し、開発へ参加するときだけ`develop`からfeature branchを作成してください。

## 3. packageと環境ファイルを準備する

macOS／Linux：

```console
npm install
cp .env.example .env
```

PowerShell：

```powershell
npm install
Copy-Item .env.example .env
```

既定の`.env`にはsecretがなく、そのままLocal plannerを利用できます。

```dotenv
XDB_HOST=127.0.0.1
XDB_PORT=4310
XDB_DATABASE_PATH=.data/xdb.sqlite
XDB_ARTIFACTS_PATH=.data/artifacts
```

実API keyは`.env`だけへ保存し、Gitへ追加しないでください。

## 4. 起動方法を選ぶ

### 開発モード

```console
npm run dev
```

- Web UI: `http://127.0.0.1:4311`
- API: `http://127.0.0.1:4310`
- source変更時に自動更新

terminalで`Ctrl+C`を押すと停止します。

### build済み構成をローカルで確認する

```console
npm run build
npm start
```

Web UIとAPIを`http://127.0.0.1:4310`から配信します。これはローカル確認用です。認証、rate limit、TLS、backup、監視を追加せず、`XDB_HOST=0.0.0.0`へ変更して一般公開しないでください。

### MCP serverだけを起動する

通常はAI clientがchild processとして起動するため、手動起動は不要です。接続診断時だけ次を使用します。

```console
npm run dev:mcp
```

stdioはAI clientとの通信用です。terminalへ通常のWeb画面は表示されません。

## 5. 初回確認

Web UIを開けることを確認し、別terminalからhealth endpointを確認します。

```console
curl http://127.0.0.1:4310/api/health
```

開発モードではAPI portが4310、画面は4311です。build済み構成では両方とも4310です。

コード変更を行った場合は次を実行します。

```console
npm run typecheck
npm run lint
npm test
npm run build
```

## 6. 保存場所とbackup

| データ | 既定path | Git管理 |
| --- | --- | --- |
| SQLite | `.data/xdb.sqlite` | しない |
| 生成artifact | `.data/artifacts/` | しない |
| 通常設定 | `design.config.json` | する |
| secret／接続設定 | `.env` | しない |

データを移動・backupするときは、XDBを停止し、SQLiteと`.data/artifacts/`を同じ時点の一組として扱います。詳細は[Operations and recovery](OPERATIONS.md)を参照してください。

## 7. 更新

作業中の変更がないことを確認してから更新します。

```console
git status
git pull --ff-only
npm install
npm run build
```

起動時にSQLite migrationが適用されます。重要データがある場合は更新前に`.data/`をbackupしてください。

## 8. 任意接続

- AI clientから利用する: [AI client setup](AI_CLIENTS.md)
- Web UIの操作: [User guide](USER_GUIDE.md)
- Claude planning provider: [Claude provider](../skills/xdb-design-intelligence/references/claude-provider.md)
- Figmaへ書き込む: [Figma delivery](../skills/xdb-design-intelligence/references/figma-delivery.md)
- 問題が起きた場合: [Troubleshooting](TROUBLESHOOTING.md)

## 9. アンインストール

1. XDB processを停止する。
2. 必要なら`.data/xdb.sqlite`と`.data/artifacts/`を同じbackupへ保存する。
3. Codex等へ登録した`xdb` MCP serverを解除する。
4. cloneしたrepository directoryを削除する。

repository directoryと一緒に`.data/`を削除すると、Research、Request、Plan、評価、artifactは復元できません。外部Figmaへ作成済みのnodeはlocal directoryを削除しても消えないため、記録済みfile／node IDとFigma version historyを別途確認してください。
