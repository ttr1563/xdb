# XDB Claude Code instructions

@skills/xdb-design-intelligence/SKILL.md

XDBのDesign Request、Knowledge、Plan、Artifact、Evaluationを正本として扱ってください。Claude独自の非構造化メモを正本にせず、既存のAPIとZod contractを利用します。

- 変更前に`design.config.json`でproviderとoutput adapterを確認する。
- credentialをprompt、artifact、DB、log、commitへ含めない。
- Anthropic APIを実行する前にmodel、費用上限、停止条件、接続設定を確認する。
- Figmaへの書き込みは対象fileと権限を確認し、生成済みoperation planに従う。
- 自動評価を人間の承認として扱わない。
- 変更後は`npm run validate`を実行する。

主要な設計は`docs/ARCHITECTURE.md`、運用・復旧は`docs/OPERATIONS.md`を参照してください。
