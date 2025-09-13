# crisis-watcher-satellite

人工衛星の周回軌道オープンデータを“広く・反復的に・自動で”取得する TypeScript ベースのリポジトリです。

現段階では認証不要のデータ源（CelesTrak）に限定し、6時間おきに最新要素（GP/OMM）と SATCAT メタ、SupGP（一例）を収集します。Space-Track や CDDIS（IGS SP3）など認証が必要な高精度・履歴系は後日追加予定です。

## 収集対象（初期実装）
- CelesTrak GP（OMM JSON）: `GROUP=active` の全現役衛星 → `gp_active.json`
- CelesTrak SATCAT（JSON）: オンオービットのペイロード → `satcat_onorbit_payloads.json`
- CelesTrak SupGP（JSON）: `SOURCE=SpaceX-E` → `supgp_spacex.json`

保存場所は `public/data/YYYY/MM/DD/HH/` 階層。直近スナップショットを `public/data/latest/` に複製します。各時刻ディレクトリには `index.json`（メタ情報＋ファイル参照）を出力します。

## スケジュール実行
- GitHub Actions で 6時間おき（cron: `11 */6 * * *`）に収集・コミット。
- レート/礼儀: CelesTrak は約2時間間隔で更新されるため、6時間周期は安全側です。

## 使い方（ローカル）
- 前提: Node.js 22.x（`.node_version` 参照）

```
npm i
npm run satellite
```

結果は `public/data/` 配下に出力されます。

## 将来拡張（計画）
- Space-Track（最新/履歴の `gp`/`gp_history`）対応（認証必須）
- CDDIS/IGS, Copernicus POD, ILRS 等の SP3 精密軌道取得
- 取得スキーマ統合（objects/gp_elements/sp3_ephemeris）

## ライセンス/出典
- データの出典を明示し、各提供元の利用規約・レート制限を遵守してください。
- 本リポジトリのコードは MIT 相当を想定（データは各出典のライセンス/規約に従います）。

## 参考
- CelesTrak GPデータ形式とAPI: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- CelesTrak SATCAT: https://celestrak.org/satcat/
