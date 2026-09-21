# 出典と収録版

## 一般小説の執筆スキル

- 開発元: [daraskme/ja-novel-writing](https://github.com/daraskme/ja-novel-writing)
- 収録した4分割版: [novel-remission-online の公開コミット dbf0de7](https://github.com/daraskme/novel-remission-online/tree/dbf0de7da87b8e433b14309d68c914b25593ff33/.agents/skills)
- 収録先: `skills/ja-novel-bible`、`ja-novel-plot`、`ja-novel-write`、`ja-novel-revise`
- 各スキル内の `CREDITS.md` と `.skill-build.json` を保持。

2026-09-21時点で、元リポジトリの公開main（`a08616de0de06581589e7b6d0456022763e4b6a6`）は単一入口の版です。このシステムの4分割版とは一致しません。手元の開発用リポジトリの未コミット変更は収録していません。

## 追加スキル

- [daraskme/ja-ero-novel-writing](https://github.com/daraskme/ja-ero-novel-writing)
- 確認した公開版: `3a8b7313282b2fc1a9c7c27f823438c7387567cb`
- 外部の任意追加スキルとして案内。一般小説プロジェクトの初期作成では導入しません。

## 校閲リーダー

- 元実装: [novel-remission-online の reader/](https://github.com/daraskme/novel-remission-online/tree/95029c5/reader)。サーバー認証は同コミットのserver/feedback.js・functions/を基に汎用化
- 作品名と送信先の固定を外し、作品設定からの読込み、配信原稿の版記録、Cloudflare Secretsによる送信・送信先一致検査、衝突しにくい指示ファイル名、汎用ビルドを追加。
- 実作品の本文、設定、作者の修正指示は収録していません。

本リポジトリは公開された制作システムです。元資料の出典表記を保持し、作品本文の権利は各作者に帰属します。
