# XDB Design Intelligence

XDBは、人のデザイン評価を文脈付きナレッジとして蓄積し、その根拠からWebデザインを計画してFigma・HTMLへ変換するlocal-firstのデザイン研究環境です。

## 提供する一連の流れ

```text
Design Request
  -> Research retrieval
    -> Design Plan
      -> Figma plan/script + responsive HTML
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
| Research | 評価理由、文脈、コンセプト、出典、利用許可をナレッジとして保存 | 利用可能 |
| Planning | LocalまたはClaudeで根拠付きDesign Planを生成 | Localのみ利用可能 |
| HTML | semantic／responsiveなstandalone HTMLを生成・比較 | 利用可能 |
| Figma | operation planと`use_figma`実行scriptを生成 | plan生成まで可能 |
| Illustration | Style Profile、構図、safe area、禁止表現を仕様化 | 仕様生成まで可能 |
| Evaluation | 自動構造評価、人間評価、候補間比較を分離して保存 | 利用可能 |
| Export | 全データのJSONと評価履歴のJSONLを出力 | 利用可能 |

Claude、Figma、画像生成providerは任意です。未接続の機能を実行済みとは表示せず、`partial`、`blocked_external`、または明示的なfallbackとして記録します。

## 現在のFigma境界

XDBはFigma用のoperation planと`use_figma`向け実行scriptを生成します。Figma account、既存file、MCP write接続が設定されていない場合は、runを`partial`または`blocked_external`として記録し、実行済みとは表示しません。接続後、SkillのFigma delivery手順に従って対象fileを調査してからscriptを実行します。

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
4. Researchから関連ナレッジが検索され、Design Planが生成される。
5. HTML previewまたはFigma operation planを確認する。
6. Evaluateで採否、スコア、比較理由を保存し、次のPlanningへ利用する。

## Claudeを使う

`.env`へ次を設定します。値はGitへ追加しないでください。

```dotenv
XDB_ANTHROPIC_API_KEY=your-api-key
XDB_ANTHROPIC_MODEL=your-enabled-model-id
XDB_ANTHROPIC_BASE_URL=https://api.anthropic.com
```

model IDはAnthropic側の提供状況・retirement・account権限に依存するため、XDBでは固定していません。UIのPlanning AIでClaudeを選ぶとMessages APIを使用します。Claudeのtool resultはZodで検証され、ID、knowledge lineage、Style Profile IDはXDB側で付与されます。

Claude未接続、timeout、不正なresponseの場合は`design.config.json`の`fallbackToLocal`に従います。fallback時はPlanに`provider: local`と`fallbackUsed: true`を記録し、Claude生成とは表示しません。実行監査は`GET /api/ai-runs`で確認できます。

Claude Codeからrepositoryを開く場合は、rootの[CLAUDE.md](CLAUDE.md)が共通XDB Skillを読み込みます。Claude Codeからも同じAPI・Design Plan・評価契約を使用します。

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
- Claudeの有効化、timeout、最大output token、local fallback
- Adapterの有効／無効
- illustration候補数とhuman approval
- evaluationとprovenanceの記録方針

接続先とsecretだけを環境変数で設定します。

## Data export

- `GET /api/export`: 全domain dataのversion付きJSON
- `GET /api/export/evaluations.jsonl`: 評価履歴のJSONL
- `GET /api/ai-runs`: AI provider、model、token使用量、latency、fallback、errorの監査履歴

外部referenceは公開されているだけでは学習利用可能とみなしません。source、license、capture time、training eligibilityを個別に記録します。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [XDB agent skill](skills/xdb-design-intelligence/SKILL.md)
- [Claude provider](skills/xdb-design-intelligence/references/claude-provider.md)

このrepositoryにはdeployment設定を含めていません。外部公開時は認証、検索index禁止、backup、監視、rate limit、rollbackを別の承認ゲートで設計してください。

## License

XDBは[MIT License](LICENSE)で公開されています。商用利用、改変、再配布、private利用が可能です。再配布時は著作権表示とLicense本文を保持してください。本Softwareは無保証で提供されます。

なお、XDBへ登録・生成するreference、画像、フォント、Figma component、外部AI出力には、それぞれ別の権利・利用条件が適用される場合があります。MIT Licenseはそれら第三者素材の利用許諾を与えるものではありません。
