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

読み手はGoogleログイン後、そのまま指示を送ります。GitHubトークンをブラウザへ入力・保存する必要はありません。管理者がPagesプロジェクトのProductionのVariables and Secretsへ次を登録し、再デプロイします。

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `FEEDBACK_GITHUB_TOKEN` | 対象作品1つ、Contents: Read and write権限のFine-grained PAT |
| Text | `FEEDBACK_REPOSITORY` | `novel.toml`と同じ`owner/name` |
| Text | `FEEDBACK_BRANCH` | `novel.toml`と同じブランチ。省略時`main` |
| Text | `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` |
| Text | `ACCESS_AUD` | このサイトを保護するAccess ApplicationのAudience Tag |

初回は作品ルートで`npm ci`を実行します。Node.js 22以上が必要です。ルートの`functions/`をWranglerが検出し、`server/feedback.js`を含めてFunctionsへバンドルします。サーバーのソース・トークンは静的配信へコピーしません。FunctionsがAccess JWTの署名・発行者・AUD・期限と同一オリジンを確認し、サーバー設定の作品の`feedback/`以下にだけ新規ファイルを作ります。

「接続状況」でログインと送信先設定の一致を確認できます。トークンの期限・権限は実際の保存時にGitHubが確認します。失効や誤登録時はCloudflareの同じSecretを更新して再デプロイします。ブラウザの下書きを消す必要はありません。ローカルでは送信APIを呼ばずMarkdownをダウンロードします。

本文閲覧と指示の保存先は、`novel.toml` の `[github]` で指定したリポジトリです。非公開リポジトリの本文も、Accessで保護した静的配信から読めます。

初回確認では、未ログインのブラウザから `/reader/`、`/main/001.txt`、`/plot/episodes.json` にアクセスし、すべてがログインを要求することを確かめます。正しいアカウントで本文を読み、テスト用の指示を1件保存して経路を確認します。
