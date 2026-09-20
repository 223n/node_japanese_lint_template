# 校正辞書

表記ゆれと誤用を拾うための辞書である。`textlint-rule-prh`が読み、`config/textlint-base.js`から参照する。

## 出典

VS Code拡張「テキスト校正くん」（`ics.japanese-proofreading`）が使う辞書をそのまま持ってきた。

| 項目 | 値 |
| --- | --- |
| 取得元 | [ics-creative/textlint-rule-preset-icsmedia](https://github.com/ics-creative/textlint-rule-preset-icsmedia) |
| 取得した版 | `400d115eecfb8b936a055a30b38192ff47dd6289` |
| 取得日 | 2026-09-21 |
| 許諾 | MIT License（Copyright (c) 2018 ICS INC.、全文は[LICENSE](LICENSE)） |

同梱した理由は、取得元がnpmに公開されておらず、`github:`参照でしか入らないためである。
配布物の依存にgit参照を混ぜると、利用側の`npm install`にgitとGitHubへの到達性を求めることになる。

なお取得元の`prh.yml`（7つの辞書を`imports`でまとめるファイル）は持ってきていない。
辞書ごとに入り切りを選べるよう、`config/textlint-base.js`が各ファイルを直に指している。

## ファイルと規則名の対応

規則名は、テキスト校正くんの設定画面に並ぶ名前と揃えてある。

<!-- textlint-disable prh -->

| ファイル | 規則名 | 見るもの |
| --- | --- | --- |
| `prh_idiom.yml` | 誤字 | 間違いやすい慣用表現（アボガド → アボカド） |
| `prh_duplicate.yml` | 重言 | 同じ意味の語の重なり（馬から落馬 → 落馬） |
| `prh_open_close.yml` | ひらく漢字 | 漢字の閉じ開き（出来る → できる） |
| `prh_redundancy.yml` | 冗長な表現 | 回りくどい言い方（することができます → できます） |
| `prh_cho_on.yml` | 外来語カタカナ表記 | 語尾の長音（プリンタ → プリンター） |
| `prh_corporation.yml` | 固有名詞 | 社名とブランド名（東京ビックサイト → 東京ビッグサイト） |
| `prh_web_technology.yml` | 技術用語 | ウェブ技術の用語（Github → GitHub） |

<!-- textlint-enable prh -->

## 更新のしかた

取得元に追従するときは、`dict/`の`prh_*.yml`を入れ替え、この文書の「取得した版」と「取得日」を書き換える。

```bash
repo=ics-creative/textlint-rule-preset-icsmedia
sha=$(gh api repos/$repo/commits/master --jq '.sha')
for f in prh_idiom.yml prh_open_close.yml prh_redundancy.yml prh_duplicate.yml \
         prh_cho_on.yml prh_corporation.yml prh_web_technology.yml; do
  gh api "repos/$repo/contents/dict/$f?ref=$sha" --jq '.content' | base64 -d > "dict/$f"
done
echo "$sha"
```

辞書の中身を書き換えると、取得元との差分が分からなくなる。
語を足したい場合は辞書を直さず、利用側で自分の辞書を`prh`の`rulePaths`に足す。
手順は[README の「規則を個別に上書きする」](../README.md)にある。
