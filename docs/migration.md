# 既存作品を引き継ぐ

既存フォルダに `init_project.py` は使いません。原稿とGitの状態を確認し、必要なファイルだけ取り込みます。

- スキル: `python scripts/install_skills.py --project ../作品`。独自変更があるスキルは上書きせず停止します。
- 校閲画面: `reader/` を作品へコピー。旧リーダーがあればGitで旧版を残してから統合します。
- ビルド: `scripts/build_site.py` と `scripts/project.py` を作品の `scripts/` へコピー。
- `novel.toml` の `[github]` に `repository = "owner/repo"` と `branch = "main"` を設定。
- `plot/episodes.json` には `number`、`title`、`kind`、`plot`、`manuscript` を置く。`plot` は `plot/episodes/001.md`、`manuscript` は `main/001.txt` のように番号で揃える。
- Cloudflareの既存ワークフロー・Secret・Access設定を使っている場合は、それらを維持してビルド部分を統合する。

このシステム用の `scripts/novel.py` は汎用版です。既存作品に借金表示や固定話数などの専用検査がある場合は、専用コマンドを維持します。汎用版でその検査を置き換えません。

旧ビルドの `_site/` があると新ビルドは停止します。中身を確認し、退避してから新ビルドを実行します。新ビルド自身が作った `_site/` には識別ファイルが付き、次回から更新できます。
