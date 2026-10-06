# Architecture

この文書はarchitectureの概要です。責務、data model、状態遷移、API、adapter、security、failure、test、将来ML境界を含む詳細設計は[System Design](SYSTEM_DESIGN.md)を参照してください。

## Domain boundaries

```text
Client / Agent Skill
        |
        v
Input Hook -> Research -> Planning -> Creation -> Evaluation
                 ^                         |
                 +----- human feedback ----+
```

### Research

`KnowledgeItem`は、見た目のreferenceだけでなくcontexts、concepts、evidence、provenance、権利状態、lifecycle、重複lineageを持ちます。Design Requestの参考URLは`RequestReference`として隔離し、許可されたclientによる構造化分析と人間の承認を経たものだけをKnowledgeへ変換します。context aliasはcanonical taxonomyへ正規化し、metadata SHA-256と画像のexact／perceptual hashで重複を識別します。検索はactiveな非重複データだけを対象に、承認済みのrequest固有referenceを優先し、その後に入力文、対象、目的、concept、avoid条件の一致を使う決定的な初期rankingです。学習用snapshotはさらに権利確認済みかつ学習利用可のデータへ限定します。将来のlearning-to-rankは同じidentifierとcomparison labelを利用します。

### Planning

`DesignPlan`はFigmaやHTMLに依存しないcanonical contractです。次を含みます。

- rationaleと参照knowledge ID
- semantic section構造
- DTCGへ変換可能なsemantic tokens
- component・variant intent
- illustration purpose、style profile、safe area、required／avoid条件

Planning providerは`local | anthropic`から選択します。localは決定的なoffline実装です。Anthropic adapterはMessages APIの強制tool callから内容案だけを受け取り、ID、request／knowledge lineage、Style Profile、provider metadata、timestampをserver側で付与します。不正なtool resultはZod validationで拒否します。

### Creation

AdapterはDesign Planから派生artifactを作ります。

- HTML Adapter: noindexのstandalone semantic HTMLとresponsive CSS
- Figma Adapter: target discoveryを前提としたoperation planと`use_figma`実行script
- Image Adapter: provider未確定。v1ではIllustration Specを生成し、外部生成を実行済みと表示しない

Figma／HTMLを同時に正本としません。canonical Planを正本、各出力をversion付き派生artifactとし、将来の手動変更はdriftとして扱います。

### Evaluation

自動評価は、section coverage、semantic token、knowledge lineageなど観測可能な構造だけを採点します。人間の美的評価とは別recordです。PairwiseComparisonは、候補A/B、選択、理由、元requestを保持します。

## Storage

- SQLite: relationships、status、score、provenance、migration version
- Filesystem: HTML、Figma plan/script、illustration spec、reports、local uploadされたreference image
- SHA-256: artifact integrity
- JSON export: data portability
- JSONL export: evaluation eventと、hash付きtraining dataset snapshot
- AI run audit: provider、model、token使用量、latency、fallback、error。credential、prompt全文、response全文は保存しない

画像binaryをSQLiteへ保存しません。将来object storageへ移す際はArtifactStoreだけを交換します。

## Migration

DBは`schema_migrations`でversion管理します。migrationはtransaction内で適用し、失敗時にrollbackします。将来PostgreSQLへ移行する場合もdomain contractとexport formatを維持し、repository実装を交換します。

## Security boundary

- XDBはsingle-user localを初期運用とする。
- `.env`のsecretをartifact、DB、logへ保存しない。
- external writeはadapterの接続状態とtarget authorizationを確認する。
- source/license未確認referenceは`trainingEligible: false`。
- XDB serverはDesign Requestへ入力された任意URLを取得しない。内容確認は利用者が許可したresearch clientの境界で行う。
- public deploymentは本設計の範囲外。認証なしで公開しない。
