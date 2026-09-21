# この作品の制作

- 再開時は `STATUS.md` を読む。作者の指示、確定した設定、既出本文を優先する。
- 設定・文体は `ja-novel-bible`、プロットは `ja-novel-plot`、本文は `ja-novel-write`、検証・推敲は `ja-novel-revise` を使う。校閲指示の受け渡しは `darask-novel-workflow`。
- スキルの標準保存先より、作品の `main/`・`plot/`・`wiki/` を優先する。bible/style相当はwiki、canon相当はwiki/canon、manuscript相当はmain。
- `main/NNN.txt` は採用本文だけ。題名は `plot/episodes.json`、制作メモは本文の外へ置く。
- 小場面は `work/scenes/chNNN-s01.md`、順序は `plot/beats/chNNN.toml`。結合は `python scripts/novel.py assemble N`。
- 最低字数は `novel.toml` のproduction設定を参照し、`count`で実測する。短い区間を定型説明で引き延ばさない。
- 本文を直接修正したら、先に対応する小場面へ差分を戻す。設定・状態の変更は根拠付きでwiki/canonへ戻す。
- 校閲指示は `feedback/README.md` に従い、対象版と引用を確認して反映する。
- 検査は字数・表記・同期の補助。文学的な品質や作者の承認と同じ意味にしない。
- 外部送信、投稿、公開、マージは依頼と既存の許可の範囲で行う。
