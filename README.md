# node_japanese_lint_template

日本語の技術文書を検査するための共有設定と、その利用見本である。

`textlint`と`markdownlint`の規則を1つのパッケージにまとめてあり、
利用する側は依存を1つ足して設定を2行書くだけで済む。
禁じた語彙がソースに混入していないかを見る道具（`lint-vocabulary`）も同梱している。

## 何ができるか

| 検査 | 道具 | 見るもの |
| ---- | ---- | ---- |
| `lint:md` | `markdownlint-cli2` | Markdownの書式 |
| `lint:ja` | `textlint` | 日本語の書き方。文体、一文の長さ、助詞の連続など |
| `lint:vocab` | `lint-vocabulary` | 禁じた語彙がソースに混入していないか |

`lint:md`と`lint:ja`は警告があっても通る。
`lint:vocab`は引っかかると失敗する。

## 導入手順

### 既存のプロジェクトに足す

依存を入れる。

```bash
npm install --save-dev \
  github:223n/node_japanese_lint_template#v1.0.0 \
  textlint markdownlint-cli2
```

`textlint`と`markdownlint-cli2`を並べて書くのは、この2つが実行する道具そのものだからである。
共有設定の側は`peerDependencies`として宣言してあり、利用側が版を選べる。

設定ファイルを2つ置く。

```javascript
// .textlintrc.js
module.exports = require('@223n/lint-config-ja/config/textlint.js')
```

```jsonc
// .markdownlint-cli2.jsonc
{
  "config": {
    "extends": "@223n/lint-config-ja/config/markdownlint.jsonc"
  },
  "globs": ["**/*.md"],
  "ignores": ["node_modules/**"]
}
```

検査の対象から外すものを書く。

```text
# .textlintignore
node_modules/**
```

除外の書き方は`.gitignore`と違う。
`node_modules/`のように末尾をスラッシュで終えても効かない。
ディレクトリごと外すときは`node_modules/**`と書く。

`package.json`に呼び出しを足す。

```jsonc
{
  "scripts": {
    "lint": "npm run lint:md && npm run lint:ja",
    "lint:md": "markdownlint-cli2",
    "lint:md:fix": "markdownlint-cli2 --fix",
    "lint:ja": "textlint .",
    "lint:ja:fix": "textlint --fix ."
  }
}
```

これで`npm run lint`が動く。

### 新しいプロジェクトを作る

GitHubの「Use this template」から作ると、設定と見本が入った状態で始まる。
不要な`example/`と`test/`は消してよい。

### 語彙検査も使う

`lint-vocabulary.config.json`を置き、`package.json`に呼び出しを足す。

```jsonc
{
  "scripts": {
    "lint:vocab": "lint-vocabulary"
  }
}
```

設定の書き方は[語彙検査](docs/語彙検査.md)にある。

## 設定を変える

### 文体をですます調にする

```javascript
// .textlintrc.js
module.exports = require('@223n/lint-config-ja/config/textlint-desumasu.js')
```

### 一部だけ変える

設定を作る関数を直に呼ぶ。

```javascript
// .textlintrc.js
const { createTextlintConfig } = require('@223n/lint-config-ja/config/textlint-base.js')

module.exports = createTextlintConfig({
  style: 'ですます',            // 'である'（既定）か 'ですます'
  sentenceLength: 100,          // 一文の最大文字数。既定は 120
  maxKanjiContinuousLen: 5,     // 漢字を連ねてよい上限。既定は 6。false で規則ごと切る
  strictSentenceEnd: true,      // 文末の句点を厳しく見る。既定は false
  jtfStyle: false,              // 日本翻訳連盟のスタイルガイドを当てる。既定は true
  halfWidthSpacing: 'always',   // 全角と半角の間のスペース。既定は 'never'
})
```

よく使うのは次の2つである。

`jtfStyle`を`false`にすると、日本翻訳連盟のスタイルガイド（37の規則）を丸ごと外す。
指摘が多すぎて手が付けられないときの逃げ道である。

`halfWidthSpacing`は全角と半角の間のスペースを決める。
既定の`'never'`は「入れない」を求める。
`'always'`にすると「入れる」を求め、`false`にすると見ない。

### 規則を個別に上書きする

作った設定に手を入れる。

```javascript
// .textlintrc.js
const config = require('@223n/lint-config-ja/config/textlint.js')

config.rules['preset-ja-technical-writing']['no-exclamation-question-mark'] = false

module.exports = config
```

`markdownlint`は`extends`のあとに書いたものが勝つ。

```jsonc
{
  "config": {
    "extends": "@223n/lint-config-ja/config/markdownlint.jsonc",
    "MD013": { "line_length": 120 }
  }
}
```

## 版を固定する

タグで指す。

```jsonc
{
  "devDependencies": {
    "@223n/lint-config-ja": "github:223n/node_japanese_lint_template#v1.0.0"
  }
}
```

`package-lock.json`にはタグではなくコミットの識別子が記録されるため、
`npm ci`は常に同じものを入れる。
規則を上げるときはタグを書き換える。

## パッケージとして公開する

git参照のままでも使えるが、npmに登録すると導入が短くなり、版の範囲指定が使える。

```jsonc
{
  "devDependencies": {
    "@223n/lint-config-ja": "^1.0.0"
  }
}
```

git参照はタグで一点を指すだけなので、修正版が出ても自動では入らない。
`^1.0.0`と書ければ、後方互換のある修正は`npm update`で入る。

### 一度だけの設定

公開は`.github/workflows/release.yml`が行い、認証にTrusted Publishing（OIDC）を使う。
そのためトークンを秘密として置く必要はない。

ただし**Trusted Publisherの設定は、パッケージがnpmに存在して初めて現れる**。
そのため順序は次のようになる。

#### 1. 手元から一度だけ公開する

`223n`のアカウントを作ったうえで、次を実行する。

```bash
npm login
npm publish --access public
```

スコープ付きのパッケージは`--access public`を付けないと非公開の扱いになり、有料のプランを求められる。

`npm login`を済ませずに実行すると認証で失敗する。
また、`package.json`の`name`のスコープ（`@223n`）と、npmのアカウント名またはorganization名が一致している必要がある。

#### 2. Trusted Publisherを設定する

公開するとパッケージの設定画面が現れる。
npmjs.comで「Packages」から対象のパッケージを開き、「Settings」の「Trusted publishing」で次を入れる。

| 項目 | 入れる値 |
| ---- | ---- |
| 提供元 | GitHub Actions |
| 所有者 | `223n` |
| リポジトリ | `node_japanese_lint_template` |
| ワークフローのファイル名 | `release.yml` |
| 環境 | 空でよい |

ファイル名は経路を含めず、`release.yml`とだけ書く。

#### 3. 以降は自動になる

2回目からはタグを切るだけでよい。
手元での`npm login`も、トークンの保存も要らない。

### GitHub Packagesにも公開する

`release.yml`はnpmと同時にGitHub Packagesへも公開する。
こちらは`GITHUB_TOKEN`で認証するため、設定は要らない。

ただし**GitHub Packagesは公開されたパッケージでも取得に認証を求める**。
GitHubの文書は「private、internal、publicのいずれのパッケージも、公開・取得・削除にアクセストークンが必要」と述べている。

そのため利用側には`.npmrc`と個人アクセストークンが要る。

```text
# .npmrc
@223n:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

トークンには`read:packages`の権限が要る。
GitHub Actionsから使う場合は、その実行の`GITHUB_TOKEN`をそのまま渡せる。

### どれを使うか

3つの経路があり、利用側の手間が違う。

| 経路 | 利用側に要るもの | 版の指定 |
| ---- | ---- | ---- |
| npm | 依存を1行書くだけ | `^1.0.0`の範囲指定が使える |
| git参照 | 依存を1行書くだけ | タグで一点を指す |
| GitHub Packages | `.npmrc`とアクセストークン | `^1.0.0`の範囲指定が使える |

**特に理由が無ければnpmを使うのがよい。**
認証が要らず、範囲指定も使えるためである。

GitHub Packagesは、npmを使わない方針の組織や、GitHubの中で完結させたい場合に選ぶ。

### 公開の手順

版を上げ、タグを切って押す。

```bash
npm version patch   # または minor / major
git push --follow-tags
```

`release.yml`が動き、次の順に確かめてから公開する。

1. タグと`package.json`の版が一致するか
1. 検査が通るか
1. 配布物に余計なものが入っていないか

版を上げ忘れたままタグを切ると、公開の前に止まる。
公開は実質取り消せない（`npm unpublish`は72時間以内に限られる）ため、手前で止める。

## 非公開のリポジトリとして使う場合

このリポジトリを公開しないまま使うこともできるが、認証の設定が要る。

手元では、GitHubへのSSH鍵か認証情報の補助が入っていれば動く。
短縮形ではなく完全な形で書くほうが確実である。

```jsonc
{
  "devDependencies": {
    "@223n/lint-config-ja": "git+ssh://git@github.com/223n/node_japanese_lint_template.git#v1.0.0"
  }
}
```

GitHub Actionsでは、`actions/checkout`が使う既定の権限が自分のリポジトリしか読めない。
別のリポジトリを引くには、次のどちらかを足す。

```yaml
# 細かい権限を絞ったトークンを秘密として置く場合
- run: git config --global url."https://x-access-token:${{ secrets.LINT_TOKEN }}@github.com/".insteadOf "https://github.com/"
- run: npm ci
```

```yaml
# デプロイ鍵を置く場合
- uses: webfactory/ssh-agent@v0.9.1
  with:
    ssh-key: ${{ secrets.LINT_DEPLOY_KEY }}
- run: npm ci
```

## 何が入っているか

| 位置 | 中身 |
| ---- | ---- |
| `config/textlint.js` | である調の設定。既定 |
| `config/textlint-desumasu.js` | ですます調の設定 |
| `config/textlint-base.js` | 設定を作る関数。細かく変えるときに使う |
| `config/markdownlint.jsonc` | Markdownの検査規則 |
| `bin/lint-vocabulary.mjs` | 語彙検査の実行ファイル |
| `example/` | 利用見本。実際に検査が通ることを確かめられる |
| `test/` | 語彙検査の検証 |
| `docs/` | 規則の理由と、語彙検査の設定方法 |

## 見本を動かす

```bash
npm install
npm run example
```

`example/`は`file:..`でこのリポジトリを参照している。
規則を変えたときに、利用側から見てどうなるかをその場で確かめられる。

## 開発

```bash
npm install
npm run lint      # このリポジトリ自身の文書を、このリポジトリが配る規則で検査する
npm test          # 語彙検査の検証
npm run example   # 利用見本の検証
npm run check     # 上の3つをまとめて
```

## 文書

- [規則の理由](docs/規則の理由.md) — どの規則をなぜ切ったか
- [語彙検査](docs/語彙検査.md) — `lint-vocabulary`の設定と使い方

## ライセンス

Apache License 2.0。[LICENSE](LICENSE)を見よ。
