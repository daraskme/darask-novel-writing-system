# スキルの導入と使い分け

一般小説には [ja-novel-writing](https://github.com/daraskme/ja-novel-writing) を使います。本システムは [収録版](../SOURCES.md) の4スキルを自己完結したフォルダで同梱し、新しい作品の `.agents/skills/` へ配置します。

設定を作る依頼は `ja-novel-bible`、構成は `ja-novel-plot`、執筆は `ja-novel-write`、原稿の修正は `ja-novel-revise`。すべての依頼で4工程を繰り返す必要はありません。

## 成人向け作品の追加スキル

[ja-ero-novel-writing](https://github.com/daraskme/ja-ero-novel-writing) は別の入口です。一般用の管理構成を使いながら、対象作品の執筆工程に必要なときだけ選びます。導入・更新の詳細は元リポジトリを参照してください。

作品ルートで追加する例:

```sh
git clone https://github.com/daraskme/ja-ero-novel-writing.git .agents/skills/ja-ero-novel-writing
```

このコマンドはスキルの開発リポジトリを作品内にcloneします。作品側のGitには**入れ子のリポジトリとしてそのままaddしません**。外部導入として `.gitignore` に `.agents/skills/ja-ero-novel-writing/` を追加して使うか、Git submoduleとして管理してください。再現する版を固定したい場合は、clone先で `git checkout 3a8b7313282b2fc1a9c7c27f823438c7387567cb` を実行します。

## 他のエージェントで使う

スキルは `SKILL.md` と参照資料を含むフォルダです。`.agents/skills/` を認識しないツールでは、使うスキルの `SKILL.md` のパスを依頼文へ渡すか、そのツールのスキル配置先へフォルダごとコピーします。原稿・設定・進捗の正本は作品ルートに置いたままにします。

元スキルの標準保存先と作品の `main/plot/wiki` が異なる場合は、作品の `AGENTS.md` の対応表を優先します。
