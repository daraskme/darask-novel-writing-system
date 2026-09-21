# Cloudflare Pagesで校閲する

作品リポジトリの `scripts/build_site.py` が、索引に載った採用本文とリーダーだけを `_site/` へ出力します。`wiki/`、詳細プロット、制作中の断片、`feedback/`、認証情報は配信対象に含めません。

## 1. Pagesプロジェクトを作る

CloudflareでDirect UploadのPagesプロジェクトを作ります。CLIを使う場合は、Node.jsとWranglerを利用できる環境で:

```sh
npx wrangler login
npx wrangler pages project create my-novel-reader --production-branch main
```

プロジェクト名は任意です。手順の根拠は [Cloudflare公式のDirect UploadとCI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/) を参照してください。

## 2. 原稿の閲覧範囲を設定する

未公開原稿を読むサイトは、最初のアップロード前にCloudflare AccessのSelf-hosted applicationへ登録します。対象は `my-novel-reader.pages.dev` の**全パス**です。作者・校閲者のログインだけをAllowにします。プレビュー用ホストや独自ドメインも使う場合は、それぞれ保護対象に含めます。

`/reader/` だけを保護しても `/main/001.txt` から本文を取得できます。保護はホスト全体に適用してください。設定方法は [Cloudflare Access公式](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/) に従います。

## 3. GitHub Actionsの設定

作品リポジトリの Settings → Secrets and variables → Actions に登録します。

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | 対象アカウントのCloudflare Pages: Edit権限を持つトークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | 作成したPagesプロジェクト名 |
| Variable | `CLOUDFLARE_DEPLOY_ENABLED` | 閲覧範囲を設定したあとに `true` |

テンプレートの `.github/workflows/deploy.yml` は `main` へのpushでビルド・デプロイします。初期状態では有効化変数がないのでデプロイしません。本文の変更をマージすると、同じ校閲URLへ新しい版が届きます。

手元からアップロードする場合:

```sh
python scripts/build_site.py
npx wrangler pages deploy _site --project-name my-novel-reader --branch main
```

Cloudflareのトークンを原稿リポジトリやブラウザへ書かないでください。GitHub ActionsはSecretsから、Wranglerはログインまたは環境変数から認証します。

## 4. 指示をGitHubへ送る

リーダーの⚙でFine-grained PATを設定します。対象は作品リポジトリ1つ、Contents: Read and write。トークンはそのタブのsessionStorageに保存し、GitHub APIへの通信にだけ使います。空欄で保存すると削除します。トークンがなければ指示をMarkdownでダウンロードできます。

本文閲覧と指示の保存先は、`novel.toml` の `[github]` で指定したリポジトリです。非公開リポジトリの本文も、Accessで保護した静的配信から読めます。

初回確認では、未ログインのブラウザから `/reader/`、`/main/001.txt`、`/plot/episodes.json` にアクセスし、すべてがログインを要求することを確かめます。正しいアカウントで本文を読み、テスト用の指示を1件保存して経路を確認します。
