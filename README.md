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
- Planning: 関連ナレッジから情報構造、DTCG tokens、components、illustration specを生成
- Creation: `figma | html | both`を選択
- Evaluation: 自動構造評価と人間の比較評価を区別して保存
- Illustration: Style Profile、禁止表現、copy-safe area、生成条件を管理
- Skill: AI agentから同じワークフローを再利用

## 現在のFigma境界

XDBはFigma用のoperation planと`use_figma`向け実行scriptを生成します。Figma account、既存file、MCP write接続が設定されていない場合は、runを`partial`または`blocked_external`として記録し、実行済みとは表示しません。接続後、SkillのFigma delivery手順に従って対象fileを調査してからscriptを実行します。

## ローカル起動

Requirements: Node.js 24以上。

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
- Adapterの有効／無効
- illustration候補数とhuman approval
- evaluationとprovenanceの記録方針

接続先とsecretだけを環境変数で設定します。

## Data export

- `GET /api/export`: 全domain dataのversion付きJSON
- `GET /api/export/evaluations.jsonl`: 評価履歴のJSONL

外部referenceは公開されているだけでは学習利用可能とみなしません。source、license、capture time、training eligibilityを個別に記録します。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [XDB agent skill](skills/xdb-design-intelligence/SKILL.md)

このrepositoryにはdeployment設定を含めていません。外部公開時は認証、検索index禁止、backup、監視、rate limit、rollbackを別の承認ゲートで設計してください。
