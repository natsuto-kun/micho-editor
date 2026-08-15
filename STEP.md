# STEP.md — 開発ロードマップ

`docs/overall-design.md` のマイルストーン定義に基づく実装チェックリスト。

---

## M0 — 骨格

**完了条件**: 空のエディタが起動して文字が打てる

- [ ] `wails init` でプロジェクト生成（Go + React/TypeScript テンプレート）
- [ ] `modernc.org/sqlite` を Go モジュールに追加
- [ ] `internal/store/db.go` — SQLite 接続・PRAGMA 設定（WAL, synchronous=NORMAL, foreign_keys=ON）
- [ ] `internal/store/migrations/0001_init.sql` — scenarios / sections / media / snapshots / links テーブル作成
- [ ] `internal/store/migrations/0002_fts.sql` — FTS5 仮想テーブル + trigger 3本
- [ ] マイグレーションランナー実装（起動時に未適用分を順番に実行）
- [ ] フロントエンド依存パッケージ追加（`@codemirror/*`, `@lezer/*`, `zustand`）
- [ ] `frontend/src/editor/setup.ts` — 最小構成の CM6 `EditorState` / `EditorView` 生成
- [ ] `frontend/src/App.tsx` — CM6 を React コンポーネントとしてマウント
- [ ] `wails dev` で空エディタが起動し、日本語以外の入力ができることを確認

---

## M0.5 — IME 検証

**完了条件**: 変換が壊れない・カーソルが飛ばない（macOS + Windows 両方）

- [ ] `autosave.ts` の `view.composing` ガード実装
- [ ] `live-preview.ts` の `u.view.composing` ガード実装
- [ ] macOS (WKWebView) で日本語入力を実機確認
  - [ ] ひらがな → 漢字変換が正常に確定される
  - [ ] 変換中にカーソルが飛ばない
  - [ ] 変換確定後に `docChanged` が正しく発火する
- [ ] Windows (WebView2) で同上を確認
- [ ] 問題があればエディタコア選定を見直す（ここが判定ゲート）

---

## M1 — 編集基盤

**完了条件**: 20万字ダミーで入力レイテンシ 16ms 以下

### Go 側
- [ ] `internal/store/scenario.go` — シナリオ CRUD
- [ ] `internal/store/section.go` — セクション CRUD（body を含まない `SectionMeta` 型を分離）
- [ ] `app.go` — `OpenScenario`, `CreateScenario`, `ListSections`, `GetSection`, `SaveSection`, `CreateSection`, `MoveSection`, `DeleteSection` を公開
- [ ] `SaveSection` に楽観ロック（`WHERE id = ? AND rev = ?` → `RowsAffected == 0` で競合検知）
- [ ] fractional indexing による `sort_key` 生成ヘルパー

### フロントエンド
- [ ] `frontend/src/stores/scenarioStore.ts` — セクションメタ・dirty フラグ・rev のみ保持
- [ ] `frontend/src/stores/uiStore.ts` — UI 状態（選択中セクション ID など）
- [ ] `frontend/src/api/bindings.ts` — Wails バインディングの型付きラッパー
- [ ] `frontend/src/components/Outline.tsx` — セクションツリー表示・クリックで切り替え
- [ ] `frontend/src/editor/autosave.ts` — 800ms debounce + 5秒強制フラッシュ
- [ ] セクション切り替え時・ウィンドウ blur 時・`BeforeClose` フック時のフラッシュ処理
- [ ] `OnBeforeClose` で未保存フラッシュ完了を待ってから終了

### 検証
- [ ] 500セクション / 20万字のダミーデータを生成するスクリプト
- [ ] Chrome DevTools (WebView 接続) でキーストロークレイテンシ計測 → 16ms 以下

---

## M2 — 検索

**完了条件**: 500セクションで全文検索が 50ms 以下

- [ ] `internal/search/fts.go` — `Search(scenarioID, query, limit)` 実装
  - [ ] FTS5 MATCH クエリ + `snippet()` 関数で本文抜粋生成
  - [ ] 2文字以下のクエリは `title LIKE ?` にフォールバック
- [ ] `app.go` に `Search` を公開
- [ ] `frontend/src/components/SearchPanel.tsx` — 検索パネル UI
  - [ ] 3文字以上 → FTS、未満 → LIKE の分岐（フロント側）
  - [ ] ヒット箇所に `<mark>` ハイライト表示
  - [ ] 結果クリックで該当セクションにジャンプ
- [ ] FTS5 の `EXPLAIN QUERY PLAN` で インデックスが使われていることを確認
- [ ] 500セクションで応答 50ms 以下を計測

---

## M3 — 独自記法

**完了条件**: `:::npc` / `:::handout` ブロックがライブプレビューで装飾表示される

### パーサ（フロントエンド）
- [ ] `frontend/src/editor/markdown-ext.ts` — `@lezer/markdown` の `MarkdownConfig` 実装
  - [ ] `:::npc`, `:::handout`, `:::check`, `:::secret`, `:::box` ブロックパーサ
  - [ ] `[[WikiLink]]` インラインパーサ
  - [ ] 閉じ `:::` がない場合も文書末まで寛容にノード化

### ライブプレビュー
- [ ] `frontend/src/editor/live-preview.ts` — `ViewPlugin` 実装
  - [ ] `view.visibleRanges` のみ走査（ドキュメント全体は走査しない）
  - [ ] カーソルがブロック内にある間は生の記法を表示
  - [ ] `atomicRanges` を提供してウィジェットをカーソルが飛び越えられるようにする
- [ ] `frontend/src/editor/widgets/NpcWidget.ts` — NPC ブロックの置換ウィジェット
- [ ] `frontend/src/editor/widgets/` — Handout / Check / Secret / Box 各ウィジェット

### 補完
- [ ] `frontend/src/editor/completion.ts` — `[[WikiLink]]` 補完（Zustand メタから候補生成）
- [ ] `#tag` 補完

### パーサ（Go 側）
- [ ] `internal/render/goldmark.go` — goldmark 拡張（フロントと同じ記法を解釈）
- [ ] フロント / Go 両パーサの仕様を `docs/` に独立ドキュメントとして記述

---

## M4 — メディア

**完了条件**: ドラッグ&ドロップで画像が貼れる

- [ ] `internal/media/import.go` — 画像取り込み・リサイズ（`golang.org/x/image/draw`）
- [ ] `internal/media/handler.go` — AssetServer の `/media/{id}` ハンドラ
- [ ] `main.go` の `AssetServer.Handler` に `media.NewHandler` を登録
- [ ] `app.go` — `ImportMediaFromPath`, `ImportMediaFromBytes`, `ListMedia` を公開
- [ ] Wails の `OnFileDrop` でドロップされたファイルパスを取得（`DataTransfer` は使わない）
- [ ] `frontend/src/editor/widgets/ImageWidget.ts` — `![[media:id]]` を `<img>` に置換
  - [ ] `img.loading = "lazy"` 設定
  - [ ] `img.src = "/media/{id}"` — base64 埋め込み禁止
- [ ] markdown-ext.ts に `![[media:...]]` インラインパーサ追加

---

## M5 — 出力

**完了条件**: `:::secret` 除去がテストで保証される

- [ ] `internal/render/export.go` — HTML / Markdown エクスポート
  - [ ] `render.Options` に `IncludeSecret bool`, `IncludeGMNotes bool` フラグ
  - [ ] AST walk で `:::secret` ノードを条件付き除去
- [ ] **Go ユニットテスト**: GM版・PL配布版・ハンドアウト版それぞれで `:::secret` の含有/非含有を検証
- [ ] `app.go` — `ExportHTML`, `ExportMarkdown` を公開
- [ ] フロントに「GM版で出力」「PL配布版で出力」ダイアログ
- [ ] PDF 出力: WebView の印刷機能を経由する簡易実装

---

## M6 — セッションビュー

**完了条件**: シナリオ全文スクロールが滑らか

- [ ] `frontend/src/components/SessionView.tsx` — 読み取り専用ビュー
  - [ ] 全セクションを結合した CM6 インスタンス（viewport 仮想化が効く）
  - [ ] `:::secret` のトグル表示（GM モード切り替え）
  - [ ] `[[WikiLink]]` クリックで該当セクションにスクロール
- [ ] 20万字連結ビューでスクロールが滑らかなことを確認

---

## M7 — 履歴

**完了条件**: 任意の版に戻せる

- [ ] `internal/history/snapshot.go` — スナップショット保存（gzip 圧縮 body → `snapshots` テーブル）
- [ ] スナップショット取得タイミング検討（セクション保存時 or 一定間隔）
- [ ] `app.go` — `ListSnapshots`, `GetSnapshot` を公開
- [ ] フロントに履歴パネル — 版一覧・本文差分表示・復元ボタン

---

## M8 — 配布

**完了条件**: 他人の PC で起動する

### macOS
- [ ] Apple Developer Program への登録確認
- [ ] コード署名設定（`wails build` の signing オプション）
- [ ] 公証（notarize）処理
- [ ] `.dmg` インストーラ生成

### Windows
- [ ] Windows 11 同梱の WebView2 で動作確認
- [ ] Windows 10 向け WebView2 ブートストラップをインストーラに同梱
- [ ] `.exe` / NSIS インストーラ生成

### Linux（優先度低）
- [ ] WebKitGTK バージョン要件の確認と明記

---

## 将来拡張（バックログ）

スコープ外だが設計上の考慮が必要なもの。

- **共同編集**: Yjs (`y-codemirror.next`) + `section_updates` テーブル
- **ダイスロール連携**: `:::check` からセッションビューでロール実行
- **シナリオテンプレート**: システム別（CoC7 / SW2.5 等）の雛形生成
- **リンクグラフ**: `links` テーブル + React Flow でシーン遷移図・到達不能シーン検出
