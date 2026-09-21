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
| Secret | `FEEDBACK_GITHUB_TOKEN` | 対象作品1つ、Contents: Read and write・Pull requests: Read権限のFine-grained PAT |
| Text | `FEEDBACK_REPOSITORY` | `novel.toml`と同じ`owner/name` |
| Text | `FEEDBACK_BRANCH` | `novel.toml`と同じブランチ。省略時`main` |
| Text | `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` |
| Text | `ACCESS_AUD` | このサイトを保護するAccess ApplicationのAudience Tag |

初回は作品ルートで`npm ci`を実行します。Node.js 22以上が必要です。ルートの`functions/`をWranglerが検出し、`server/feedback.js`を含めてFunctionsへバンドルします。サーバーのソース・トークンは静的配信へコピーしません。FunctionsがAccess JWTの署名・発行者・AUD・期限と同一オリジンを確認し、サーバー設定の作品の`feedback/`以下にだけ新規ファイルを作ります。

「接続状況」でログインと送信先設定の一致を確認できます。トークンの期限・権限は実際の保存時にGitHubが確認します。失効や誤登録時はCloudflareの同じSecretを更新して再デプロイします。ブラウザの下書きを消す必要はありません。ローカルでは送信APIを呼ばずMarkdownをダウンロードします。

本文閲覧と指示の保存先は、`novel.toml` の `[github]` で指定したリポジトリです。非公開リポジトリの本文も、Accessで保護した静的配信から読めます。

初回確認では、未ログインのブラウザから `/reader/`、`/main/001.txt`、`/plot/episodes.json` にアクセスし、すべてがログインを要求することを確かめます。正しいアカウントで本文を読み、テスト用の指示を1件保存して経路を確認します。

## 5. マージ前のPR本文を校閲する

同じCloudflareの校閲URLで、索引の「校閲する版」からPRを選びます。「変更あり」が付いた話がPRで追加・変更された本文です。前後の話も同じPRの版で読めます。`/reader/?pr=7#1` のようにPR番号と話番号を指定して直接開くこともできます。

PRを更新したら「PR一覧を更新」で最新の版を開きます。下書きは通常版・PR番号・コミット・話ごとに分かれます。更新前や終了したPRの下書きは「PR下書きを保存」からMarkdownに取り出せます。

修正指示は従来と同じ送信先ブランチの `feedback/` に保存し、対象PRのURL・修正先ブランチ・閲覧コミット・本文SHA-256を記録します。執筆エージェントへの依頼文は、対象PRのブランチへ修正するよう案内します。本文の取り込みや投稿は別の操作です。

既存のPATに **Pull requests: Read** がなければ追加してください。トークンを交換した場合はCloudflareの `FEEDBACK_GITHUB_TOKEN` を更新して再デプロイします。[GitHub公式のPR API権限](https://docs.github.com/en/rest/pulls/pulls#fine-grained-access-tokens-for-list-pull-requests)を参照してください。

`GET /api/review` は送信APIと同じAccess JWTを検証し、サーバーで固定した作品のGitHub APIだけを読みます。対象は同じリポジトリの未完了PR（Draftを含む）です。ForkのPRは対象外です。PRのコードは実行せず、PRの索引にある `main/` 配下の通常ファイル（`.txt` / `.md`、各1MB以下）だけを返します。PRごとのCloudflareデプロイやプレビュー用の認証設定は不要です。
