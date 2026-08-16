# M3 独自記法 — 設計ドキュメント

**日付**: 2026-08-16  
**マイルストーン**: M3 独自記法 + ライブプレビュー + 補完  
**完了条件**: `:::npc` / `:::handout` / `:::secret` ブロックがエディタ上で装飾表示される

---

## 1. スコープ

### M3 に含むもの
- `:::npc` / `:::handout` / `:::secret` ブロックの frontend パース（regex ベース ViewPlugin）
- カーソル位置に応じたライブプレビュー（カーソル外→ウィジェット表示、カーソル内→生テキスト）
- オートコンプリート: `[[WikiLink]]` / `@NPC` / `#tag` / `:::ディレクティブ名`

### M3 に含まないもの
- Go 側の goldmark パーサ拡張（M5 で実装）
- `:::secret` の出力時除去ロジック（M5）
- 画像ウィジェット（M4）

---

## 2. アーキテクチャ

**採用アプローチ: Regex ベース ViewPlugin**

lezer パーサには手を加えず、既存の `live-preview.ts` ViewPlugin 内で可視範囲を regex スキャンして Decoration を生成する。

理由:
- 既存の ViewPlugin パターン（`view.composing` guard 済み）に沿っている
- lezer の MarkdownConfig block-parser API は複雑で実装コストが高い
- M3 の完了条件を満たすのに lezer 統合は不要
- M5 で Go 側パーサを実装するため frontend は可読性優先

### 変更・追加ファイル

```
frontend/src/editor/
  live-preview.ts          ← 既存。ディレクティブ検出＋ウィジェット装飾を追加
  completion.ts            ← 新規。[[WikiLink]] / @NPC / #tag / ::: 補完
  widgets/
    NpcWidget.ts           ← 新規。NPC テーブルウィジェット (WidgetType)
    HandoutWidget.ts       ← 新規。Handout カードウィジェット (WidgetType)
    SecretWidget.ts        ← 新規。Secret グレーアウトウィジェット (WidgetType)
    widgets.css            ← 新規。全ウィジェット共通スタイル
  setup.ts                 ← 既存。autocompletion と completion.ts を追加
```

---

## 3. live-preview.ts — ブロック検出とカーソル判定

### ブロック検出

`update()` で `view.visibleRanges` を走査し、1行ずつ正規表現でディレクティブブロックを検出する。

```
開始: /^:::(npc|handout|secret)\s*(.*)/
終了: /^:::$/
```

検出したブロックは `{ type, params, from, to, bodyFrom, bodyTo }` の構造体として一時保存する。

### カーソル判定

検出したブロックに対して、以下の条件でウィジェット化を決定する。

- カーソル（`view.state.selection.main.head`）がブロック範囲 `[from, to]` の**外**: `WidgetDecoration.replace()` で生テキストを置き換えてウィジェット表示
- カーソルがブロック範囲の**内**: 置き換えを適用しない → 生 Markdown テキストを編集可能に戻す

### パフォーマンス制約

- スキャン対象は `view.visibleRanges` のみ（CLAUDE.md の制約と一致）
- `view.composing === true` の間は `update()` を即時 return して再構築しない

---

## 4. オートコンプリート (completion.ts)

4つのトリガーを1つの `CompletionSource` 関数で処理する。`setup.ts` で `autocompletion({ override: [directiveCompletion] })` として登録する。

### `:::` ディレクティブ補完
- **トリガー**: 行頭の `:::` の直後
- **候補**: `npc`、`handout`、`secret`（固定リスト）
- **確定時**: スニペットを挿入
  - `npc` → `:::npc Name | Role | Age\n\n:::`
  - `handout` → `:::handout HO1 | PlayerA\n\n:::`
  - `secret` → `:::secret\n\n:::`

### `[[WikiLink]]` 補完
- **トリガー**: `[[` の入力後
- **データソース**: `ListSections()` の結果をモジュールスコープでキャッシュ。キャッシュが空または最終取得から 30 秒以上経過している場合に非同期で再取得し、取得完了後に `CompletionResult` を更新する（`validFor` で再利用範囲を設定）
- **確定時**: `[[タイトル]]` を挿入（`]]` まで自動補完）

### `@NPC` 補完
- **トリガー**: `@` の入力後（行頭・行中を問わない）
- **データソース**: 現在のドキュメント全文を `:::npc\s+([^|]+)` で regex スキャンして名前を抽出。外部 API 不要
- **確定時**: `@名前` を挿入

### `#tag` 補完
- **トリガー**: `#` の入力後。ただし `#` の直前（行頭から見て空白のみ）＝Markdown 見出し（`# 見出し`、`## 見出し` 等）は補完しない。判定: カーソル直前のテキストが `/^\s*$/.test(lineTextBefore)` なら見出しとして除外
- **データソース**: 現在のドキュメント全文から `#[^\s#]+` を収集し重複除去
- **確定時**: `#タグ名` を挿入

---

## 5. ウィジェット DOM 構造とビジュアルスタイル

### NpcWidget（テーブル・グリッド / 紫系）

```html
<div class="directive-npc">
  <div class="directive-npc__header">
    <span class="badge">NPC</span>
    <span class="name">田中次郎</span>
  </div>
  <table class="directive-npc__attrs">
    <tr><th>役職</th><td>探偵</td></tr>
    <tr><th>年齢</th><td>35</td></tr>
  </table>
  <div class="directive-npc__body">本文...</div>
</div>
```

**スタイル**: 紫系（`border: 1px solid #4a4a70`、ヘッダ `background: #3a3a60`）、バッジは `background: #7c6af7`

### HandoutWidget（青点線枠）

```html
<div class="directive-handout">
  <div class="directive-handout__header">
    <span class="badge">HANDOUT</span>
    <span class="id">HO1</span>
    <span class="target">→ PlayerA</span>
  </div>
  <div class="directive-handout__body">本文...</div>
</div>
```

**スタイル**: 青系（`border: 2px dashed #3a6a9a`）、テキスト `color: #b0d8f0`

### SecretWidget（グレーアウト）

```html
<div class="directive-secret">
  <div class="directive-secret__label">▓ SECRET</div>
  <div class="directive-secret__body">本文...</div>
</div>
```

**スタイル**: `opacity: 0.75`、`border-left: 4px solid #666`、テキスト `color: #aaa`

全スタイルは `frontend/src/editor/widgets/widgets.css` に定義し、`setup.ts` から import する。

---

## 6. ディレクティブ構文の仕様

```
:::npc Name | Role | Age
本文（複数行可）
:::

:::handout ID | Target
本文（複数行可）
:::

:::secret
本文（複数行可）
:::
```

- `|` 区切りのパラメータは最大3つ（npc）または2つ（handout）
- パラメータが不足している場合はウィジェットで空欄として表示（エラーにしない）
- ネストは未定義（M3 スコープ外）
- 終了 `:::` は行全体が `:::` のみであること（後続テキスト不可）

---

## 7. テスト方針

- `live-preview.ts` の regex ロジックは純粋関数として抽出し、ユニットテスト可能にする
- ウィジェット表示は `wails dev` 起動後に手動確認：
  - カーソル外でウィジェット表示されること
  - カーソルがブロック内に入ったとき生テキストに戻ること
  - IME 変換中（日本語入力）にウィジェットが壊れないこと
- オートコンプリートは各トリガー文字入力後に候補リストが出ることを手動確認

---

## 8. 完了条件

- `:::npc` ブロックが NPC テーブルウィジェットとして表示される
- `:::handout` ブロックが青点線カードとして表示される
- `:::secret` ブロックがグレーアウト表示される
- カーソルを入れると生テキストに戻る
- `[[` / `@` / `#` / `:::` でオートコンプリート候補が出る
- IME 変換中にウィジェットが崩れない
