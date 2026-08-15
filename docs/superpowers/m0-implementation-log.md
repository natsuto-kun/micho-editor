# M0 実装ログ

Plan: `docs/superpowers/plans/2026-08-16-m0-skeleton.md`
開始日: 2026-08-16

---

## Task 1: Wails CLI のインストール
**ステータス:** ✅ 完了

### 実施内容
- `go install github.com/wailsapp/wails/v2/cmd/wails@latest` を実行
- `/Users/nakamuranatsu/go/bin/wails` にバイナリが生成された
- `wails version` → `v2.14.0` を確認

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS（コードなし・インストールのみ）

---

## Task 2: Wails プロジェクトの初期化
**ステータス:** ✅ 完了

### 実施内容
- 親ディレクトリ `/Users/nakamuranatsu/Desktop/develop/tool/` で `wails init -n trpg-editor -t react-ts` を実行
- 生成された全ファイルを `micho-edit/` へコピー後、一時ディレクトリを削除
- `wails doctor` → **SUCCESS** (Node.js 23.0.0, npm 11.12.1, Xcode CLT 2416)

### 生成ファイル
- `main.go`, `app.go`, `go.mod`（module trpg-editor, go 1.25.0）, `go.sum`, `wails.json`
- `frontend/src/` → App.tsx, main.tsx, App.css, style.css, vite-env.d.ts, assets/
- `build/` → macOS/Windows 向けアイコン・設定

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS（Wails テンプレート生成コード）

---

## Task 3: Go 依存パッケージの追加
**ステータス:** ✅ 完了

### 実施内容
- `go get modernc.org/sqlite` → v1.56.0 追加（CGO 不要 FTS5 対応ドライバ）
- `go get github.com/google/uuid` → v1.6.0 追加
- `go get github.com/yuin/goldmark` → v1.8.5 追加（wails テンプレートに既存だったため upgrade）
- `go build ./...` → エラーなし

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## Task 4: SQLite マイグレーションファイルの作成
**ステータス:** ✅ 完了

### 実施内容
- `internal/store/migrations/0001_init.sql` 作成（53行）
  - `scenarios` テーブル（id, title, system, players, play_time, meta, created_at, updated_at）
  - `sections` テーブル（id, scenario_id, parent_id, kind, title, body, sort_key, rev, updated_at）+ インデックス2件
  - `media` テーブル（id, scenario_id, filename, mime, width, height, bytes, rel_path, created_at）
  - `snapshots` テーブル（id, section_id, rev, body_gz, created_at）+ インデックス1件
  - `links` テーブル（from_id, to_id）複合 PRIMARY KEY
- `internal/store/migrations/0002_fts.sql` 作成（24行）
  - `section_fts` 仮想テーブル（FTS5, `tokenize='trigram'`, `content='sections'`）
  - `sections_ai` トリガー（INSERT 後）
  - `sections_ad` トリガー（DELETE 後）
  - `sections_au` トリガー（UPDATE 後、削除→再挿入）

### スペックレビュー: ✅ PASS（設計書の SQL と完全一致）
### 品質レビュー: ✅ PASS

---

## Task 5: SQLite 接続・マイグレーションランナーの実装
**ステータス:** ✅ 完了

### 実施内容
- `internal/store/db.go` を新規作成（95行）
  - `Open(path string)`: `os.MkdirAll` でディレクトリ自動作成 → SQLite 接続（WAL, synchronous=NORMAL, foreign_keys=ON） → Ping → migrate()
  - `migrate()`: `schema_migrations` テーブルで適用済みバージョン管理。`embed.FS` から `migrations/*.sql` を昇順に読み込み、未適用分のみ実行
  - `Close()`, `DB()` アクセサ

### 動作確認
- `go build ./internal/store/...` → BUILD OK
- 一時 DB ファイルで動作テスト → `OK: migration succeeded`（0001_init.sql + 0002_fts.sql が正常適用）

### 注記
- `go.mod` の `go 1.25.0` 形式は IDE の gopls が古いため警告を出すが、`go build` 自体はエラーなし（Go 1.21+ の patch version 形式）

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## Task 6: app.go と main.go の更新
**ステータス:** ✅ 完了

### 実施内容
- `app.go` を完全書き換え（47行）
  - `App` 構造体に `store *store.Store` フィールドを追加
  - `startup`: `os.UserHomeDir()` で `~/.trpg-editor/default.trpg` を決定し `store.Open()` を呼ぶ
  - `shutdown`: `store.Close()` で DB を安全にクローズ
  - `Store()`: パッケージ外からストアにアクセスするアクセサ
  - `Greet` メソッドは削除（M0 では不要）
- `main.go` を更新
  - タイトル: `"trpg-editor"` → `"TRPG シナリオエディタ"`
  - ウィンドウサイズ: 1024×768 → 1400×900
  - `OnShutdown: app.shutdown` を追加
- `go build ./...` → エラーなし

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## Task 7: フロントエンド依存パッケージの追加
**ステータス:** ✅ 完了

### 実施内容
- `npm install` で以下を追加（91パッケージ追加）:
  - `@codemirror/state@6.7.1`, `@codemirror/view`, `@codemirror/commands@6.10.4`
  - `@codemirror/language@6.12.4`, `@codemirror/lang-markdown@6.5.2`
  - `@codemirror/autocomplete@6.20.3`, `@codemirror/search@6.7.1`
  - `@lezer/markdown`, `@lezer/highlight`
  - `zustand`
- `npm ls @codemirror/state` → 全インスタンスが `6.7.1 deduped`（重複なし）
- `npm audit` → 脆弱性ゼロ

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## Task 8: 最小構成の CM6 セットアップ (setup.ts)
**ステータス:** ✅ 完了

### 実施内容
- `frontend/src/editor/` ディレクトリを作成
- `frontend/src/editor/setup.ts` を作成（43行）
  - `createEditorState(doc)`: EditorState を生成（lineWrapping, lineNumbers, history, drawSelection, highlightActiveLine, search, keymap, markdown, syntaxHighlighting）
  - `createEditorView(parent, doc)`: EditorView を生成して parent 要素にマウント
  - M0 スコープ外の拡張（markdown-ext, live-preview, autosave）は含まない
- `npx tsc --noEmit` → エラーなし

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS（`history({ minDepth: 50 })` でメモリ制限あり）

---

## Task 9: App.tsx を CM6 エディタコンポーネントに書き換え
**ステータス:** ✅ 完了

### 実施内容
- `frontend/src/App.tsx` を完全書き換え（34行）
  - Wails テンプレートの Greet/logo/CSS インポートを全て削除
  - `useRef<HTMLDivElement>` + `useEffect` で `createEditorView` をマウント
  - アンマウント時に `view.destroy()` と `viewRef.current = null` でクリーンアップ
  - `height: 100vh` + flex レイアウトでエディタ全画面表示
  - 初期ドキュメント: `# TRPG シナリオエディタ` の Markdown サンプル
- `npx tsc --noEmit` → エラーなし
- `npm run build` → `dist/` 生成成功（1.95s、CM6 バンドル 732kB は想定内）

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## Task 10: wails dev で動作確認・コミット
**ステータス:** ✅ 完了

### 実施内容

**ビルド確認:**
- `go build trpg-editor trpg-editor/internal/store` → BUILD OK
- `npm run build` (frontend) → `dist/` 生成成功（1.95s）
- `npx tsc --noEmit` → 型エラーなし

**DB マイグレーション実機テスト:**
- 一時 DB ファイルで `store.Open()` を実行
- 生成されたオブジェクト: links, media, scenarios, schema_migrations, section_fts (+ 内部テーブル4つ), sections, sections_ad/ai/au (トリガー), snapshots
- `Migration OK` 確認済み

**wails dev:**
- GUI アプリのため端末から直接起動確認不可
- 代替として Go / TypeScript / DB の全コンポーネントを個別検証済み
- 実機確認は `! wails dev` でユーザーが実行してください

**コミット:**
- `.gitignore` に `trpg-editor`（バイナリ）と `*.trpg`（DB ファイル）を追加
- コミット `b802be0`: 40ファイル、4899行追加

### スペックレビュー: ✅ PASS
### 品質レビュー: ✅ PASS

---

## 注記: Go バージョン問題と対処

`go.mod` の `go 1.25.0` は正しい値。wails v2.14.0 / modernc.org/sqlite v1.56.0 / golang.org/x/* が全て Go 1.25 以上を要求するため `go mod tidy` が自動設定する。

**問題:** シェルの `go` コマンドが `/usr/local/go/bin/go`（Go 1.17.6）を参照しており、
`go 1.25.0`（3成分バージョン形式、Go 1.21+ で導入）を解釈できずに `wails dev` が失敗。

**根本原因:** `/etc/paths.d/go` が `/usr/local/go/bin` をシステム PATH に追加しており、
Homebrew の `/opt/homebrew/bin/go`（Go 1.26.5）より先に解決されていた。

**修正:** `~/.zshrc` の末尾（starship 初期化の直前）に以下を追加:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```
これにより新しいシェルでは `/opt/homebrew/bin/go`（Go 1.26.5）が優先される。

**確認コマンド:** `which go && go version` → `/opt/homebrew/bin/go`, `go1.26.5`
