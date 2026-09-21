# このリポジトリ

日本語小説の制作システム。実作品は `scripts/init_project.py` で別フォルダへ作る。

- `reader/` が校閲画面、`scripts/` が作成・検証・ビルド、`template/` が作品の雛形。
- `skills/ja-novel-*` はSOURCES.mdに記載した収録版。元スキルを変更する場合は収録元と差分を明記する。
- 実作品の本文、作者のフィードバック、認証情報をこの公開リポジトリへコピーしない。
- Pythonの変更は `python -m unittest discover -s tests -v`、JavaScriptの変更は `node --check reader/app.js` と該当UIの操作で確認する。
- テンプレートから新規作成した作品で動くことを確認する。公開URLや認証設定は利用者の指定に従う。
