# 作品の制作リポジトリ

現在地は [STATUS.md](STATUS.md)。作品名・最低字数・GitHub送信先は `novel.toml` で管理します。

| 場所 | 内容 |
|---|---|
| main | 採用本文 |
| plot | 索引・詳細プロット・小場面案 |
| wiki | 設定・文体・既出事実 |
| work | 小場面、結合稿、書き出し |
| feedback | 作者の校閲指示 |
| reader | Cloudflareに配信する校閲画面 |

```sh
python scripts/novel.py new 1 --title "題名"
python scripts/novel.py assemble 1
python scripts/novel.py count 1
python scripts/novel.py lint 1
python scripts/novel.py adopt 1
python scripts/novel.py check
python scripts/build_site.py
python -m http.server 8000 --directory _site
```

本文は小場面から作り、結合後の流れを推敲して採用します。採用済みの本文を直接直したら、小場面も同期してから再結合してください。

制作システムとCloudflareの導入手順: [darask-novel-writing-system](https://github.com/daraskme/darask-novel-writing-system)
