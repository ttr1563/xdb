# XDB Design Intelligence

XDBは、人のデザイン評価を文脈付きナレッジとして蓄積し、その根拠からWebデザインを計画してFigma・HTMLへ変換するlocal-firstのデザイン研究環境です。

## 提供する一連の流れ

```text
Design Request
  -> Research retrieval
    -> Design Plan
      -> editable Figma delivery + responsive HTML
        -> automatic structural review
          -> human evaluation / pairwise preference
            -> reusable knowledge
```

- Research: 要件、コンセプト、根拠、出典、採否を関連付けて保存
- Planning: Local plannerまたはClaudeで、関連ナレッジから情報構造、DTCG tokens、components、illustration specを生成
- Creation: `figma | html | both`を選択
- Evaluation: 自動構造評価と人間の比較評価を区別して保存
- Illustration: Style Profile、禁止表現、copy-safe area、生成条件を管理
- Skill: AI agentから同じワークフローを再利用

## できること

| 機能 | 内容 | 外部接続なし |
| --- | --- | --- |
| Research | 評価理由、文脈、コンセプト、出典、利用許可を保存。JSON/JSONL import、taxonomy、重複検出、除外・削除に対応 | 利用可能 |
| Planning | LocalまたはClaudeで根拠付きDesign Planを生成。Localでは3戦略の比較候補を生成 | Localのみ利用可能 |
| HTML | semantic／responsiveなstandalone HTMLを生成・比較 | 利用可能 |
| Figma | operation plan/scriptを生成し、接続済みagentがnative nodeを作成、検証証跡を保存 | plan生成まで可能 |
| Illustration | Style Profile、構図、safe area、禁止表現を仕様化 | 仕様生成まで可能 |
| Evaluation | 自動構造評価、人間評価、候補間比較を分離して保存 | 利用可能 |
| Export | 全データのJSONと評価履歴のJSONLを出力 | 利用可能 |

Claude、Figma、画像生成providerは任意です。未接続の機能を実行済みとは表示せず、`partial`、`blocked_external`、または明示的なfallbackとして記録します。

## 現在のFigma境界

XDBはFigma用のoperation planと`use_figma`向け実行scriptを生成します。接続済みagentは、Skillの手順に従って対象fileを調査し、Auto Layout、variable、既存componentを使う編集可能なdesktop/mobile frameを作成します。作成・変更node ID、構造監査、desktop/mobile screenshot確認を`FigmaDelivery`として記録できた時点でのみrunを`completed`へ更新します。

Figma account、既存file、write接続がない場合はrunを`partial`または`blocked_external`として保持します。外部writeは自動retryせず、runに固定した`operationKey`とroot名で全pageから既存結果を検出します。同じ操作の同じ証跡はreplayでき、既存rootは`observedNodeIds`として記録します。異なる証跡やoperation keyは409で拒否します。

## 導入方法

### 必要環境

- Node.js 24以上
- npm
- Claudeを使う場合のみAnthropic APIの利用権限とAPI key
- Figmaへ実際に書き込む場合のみFigma MCP接続と対象fileのwrite権限

### インストールと開発起動

```bash
cp .env.example .env
npm install
npm run dev
```

- Web UI: `http://127.0.0.1:4311`
- API: `http://127.0.0.1:4310`
- SQLite: `.data/xdb.sqlite`
- Generated artifacts: `.data/artifacts/`

実credentialは`.env`だけへ置き、Gitへ追加しないでください。

### 本番形式でのローカル起動

```bash
npm run build
npm start
```

`npm start`は既定で`http://127.0.0.1:4310`へAPIとbuild済みWeb UIを配信します。外部公開用の認証・rate limit・TLS設定は含みません。

## 基本的な使い方

1. Overviewから「新しいデザインを始める」を選ぶ。
2. プロジェクト名、対象ユーザー、目的、コンセプト、避ける表現を入力する。
3. Planning AIを`Local | Claude`、出力先を`figma | html | both`から選ぶ。
4. Researchから関連ナレッジが検索される。Localでは`conservative`、`expressive`、`conversion-led`のPlan Family、Claudeでは単一Planが生成される。
5. HTML previewまたはFigma operation planを確認する。Figma出力では対象file keyを指定し、接続済みagentでdeliveryを実行・検証する。
6. Evaluateで同じPlan Familyの互換候補を比較し、採否、スコア、比較理由を保存する。

### Researchデータを登録する

Research画面では1件ずつ登録するほか、JSON配列または1行1件のJSONLを最大500件までimportできます。各行は独立して検証され、batch履歴に作成・重複・拒否件数と行番号別エラーを残します。外部URLから画像を自動取得せず、参照画像は手元のJPEG／PNG／WebP（8 MiB以下、40 megapixels以下）だけを明示uploadします。

```json
[
  {
    "title": "Evidence-led hero",
    "summary": "比較評価で根拠が確認できたHeroパターンです。",
    "kind": "reference",
    "contexts": ["product-marketing"],
    "concepts": ["clarity"],
    "evidence": "CTA理解度の比較評価で改善を確認。",
    "provenance": {
      "sourceType": "url",
      "sourceUri": "https://example.com/reference",
      "license": "CC BY 4.0",
      "rightsStatus": "verified",
      "trainingEligible": true,
      "capturedAt": "2026-10-06T00:00:00.000Z"
    }
  }
]
```

公開されている素材でも利用許諾を推定しません。`trainingEligible: true`には`rightsStatus: verified`とlicenseが必要です。通常検索はactiveな非重複データ、学習用snapshotはさらに権利確認済みかつ学習利用可のデータだけを含みます。`exclude`は復元可能、`delete`は本文・出典・画像を消去した復元不能tombstoneです。

## Claudeを使う

`.env`へ次を設定します。値はGitへ追加しないでください。

```dotenv
XDB_ANTHROPIC_API_KEY=your-api-key
XDB_ANTHROPIC_MODEL=your-enabled-model-id
XDB_ANTHROPIC_BASE_URL=https://api.anthropic.com
```

model IDはAnthropic側の提供状況・retirement・account権限に依存するため、XDBでは固定していません。UIのPlanning AIでClaudeを選ぶとMessages APIを使用します。Claudeのtool resultはZodで検証され、ID、knowledge lineage、Style Profile IDはXDB側で付与されます。

credentialを設定しただけでは外部送信されません。`design.config.json`で次をすべて確認してから、`allowExternalRequests`を`true`にします。

- `allowedBaseUrls`にcredential送信先を完全一致で指定する（既定は`https://api.anthropic.com`のみ）。
- `monthlyTokenBudget`を1回の`maxOutputTokens`以上の正の値にする。`0`は停止を意味する。
- 利用modelの単価から月次費用上限を別途算出する。XDBの上限はtoken数であり、課金額そのものではない。
- `maxRetries`は0〜2。retryは429と5xxだけに限定される。

`monthlyTokenBudget`はXDBが記録したtokenと次requestのoutput上限によるlocal preflightです。provider側の厳密な課金capではないため、Anthropic account側のbudget・使用量アラートも併用してください。

Claude未接続、外部実行OFF、予算不足、timeout、rate limit、upstream error、不正responseは個別の`errorCode`で記録され、`fallbackToLocal`に従います。fallback時はPlanに`provider: local`と`fallbackUsed: true`を記録し、Claude生成とは表示しません。UIと`GET /api/ai-runs`でmodel、token、latency、試行回数、失敗理由を確認できます。

Claude Codeからrepositoryを開く場合は、rootの[CLAUDE.md](CLAUDE.md)が共通XDB Skillを読み込みます。Claude Codeからも同じAPI・Design Plan・評価契約を使用します。

## Claude Code・CodexからMCPで使う

XDBはlocal stdio MCP serverを提供します。HTTP endpointや外部portは開きません。先に依存packageを導入してください。

```bash
npm install
```

Claude Codeはrepository直下の`.mcp.json`を読みます。初回はworkspaceとproject-scope serverを確認・承認し、接続状態を確認します。

```bash
claude mcp get xdb
```

Codexは次のようにlocal stdio commandを登録します。`/absolute/path/to/xdb`は実際のrepository絶対pathへ置き換えます。

```bash
codex mcp add xdb -- \
  /absolute/path/to/xdb/node_modules/.bin/tsx \
  /absolute/path/to/xdb/src/server/mcp/main.ts
codex mcp list
```

`codex mcp get xdb`で`enabled: true`と絶対pathのcommand／argsを確認してください。登録前から開いているCodex sessionには新しいtoolが追加されないため、登録後に新しいsessionを開始します。Claude／Anthropicのcredentialは不要です。

新しいCodex sessionでは、たとえば次のように依頼して接続を確認できます。

```text
XDB MCPだけを使い、このデザイン依頼を分類してLocal PlanとHTML artifactを1件生成し、
requestId、planId、runId、artifact URIを返してください。
```

成功時は`xdb_create_request`、`xdb_create_plan`、`xdb_create_artifacts`、`xdb_get_run_status`が同じlineage IDを返します。write toolの失敗時に別のidempotency keyで自動retryせず、保存状態を確認してください。

公開tool：

- read: `xdb_classify_design_input`、`xdb_search_knowledge`、`xdb_get_dataset_snapshot`、`xdb_get_run_status`
- write: `xdb_import_knowledge`、`xdb_update_knowledge_lifecycle`、`xdb_create_context_taxonomy`、`xdb_create_request`、`xdb_create_plan`、`xdb_create_plan_family`、`xdb_create_artifacts`、`xdb_record_figma_delivery`、`xdb_record_evaluation`、`xdb_compare_artifacts`
- resource: `xdb://artifact/{artifactId}`

write toolは8〜128文字の`idempotencyKey`を必須とします。同じkeyとpayloadは完了済みの場合だけ保存結果を返し、別payloadへの再利用は拒否します。実行中、失敗済み、またはprocess停止等で結果不明になったkeyからdomain処理を自動再実行しません。保存状態を照合し、安全を確認した場合だけ新しいkeyで明示的に実行してください。`xdb_create_artifacts`はHTMLとFigma operation planをlocal生成し、外部write後の検証済み証跡は`xdb_record_figma_delivery`で保存します。

CodexのMCP登録形式は[OpenAI公式MCP手順](https://developers.openai.com/learn/docs-mcp)、Claude Codeのproject-scope承認は[Claude Code公式MCP手順](https://code.claude.com/docs/en/mcp)を参照してください。

## 検証

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Configuration

通常設定は`design.config.json`で管理します。

- `output.defaultMode`: `figma | html | both`
- `ai.defaultProvider`: `local | anthropic`
- Claudeの外部実行ゲート、許可URL、timeout、retry、request／月次token上限、local fallback
- Adapterの有効／無効
- illustration候補数とhuman approval
- evaluationとprovenanceの記録方針

接続先とsecretだけを環境変数で設定します。

## Data export

- `GET /api/export`: 全domain dataのversion付きJSON
- `GET /api/export/evaluations.jsonl`: 評価履歴のJSONL
- `GET /api/export/dataset.jsonl`: snapshot header、権利確認済みknowledge、taxonomy、参照画像metadataの決定的な学習用snapshot
- `GET /api/ai-runs`: AI provider、model、token使用量、latency、試行回数、fallback、error codeの監査履歴
- `GET/POST /api/figma-deliveries`: Figma外部writeのnode ID、構造監査、screenshot確認、status
- local stdio MCP: HTTP APIと同じapplication serviceをClaude Code・Codexから呼び出す

外部referenceは公開されているだけでは学習利用可能とみなしません。source、license、capture time、training eligibilityを個別に記録します。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [System design](docs/SYSTEM_DESIGN.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [XDB agent skill](skills/xdb-design-intelligence/SKILL.md)
- [Claude provider](skills/xdb-design-intelligence/references/claude-provider.md)

このrepositoryにはdeployment設定を含めていません。外部公開時は認証、検索index禁止、backup、監視、rate limit、rollbackを別の承認ゲートで設計してください。

## License

XDBは[MIT License](LICENSE)で公開されています。商用利用、改変、再配布、private利用が可能です。再配布時は著作権表示とLicense本文を保持してください。本Softwareは無保証で提供されます。

なお、XDBへ登録・生成するreference、画像、フォント、Figma component、外部AI出力には、それぞれ別の権利・利用条件が適用される場合があります。MIT Licenseはそれら第三者素材の利用許諾を与えるものではありません。
