# M4 メディア設計ドキュメント

**日付**: 2026-08-17  
**完了条件**: ドラッグ&ドロップで画像が貼れる  
**対応形式**: JPEG / PNG / WebP（常に JPEG 85% に変換して保存）  
**リサイズ上限**: 長辺 1200px

---

## 1. ファイル保存戦略

画像は SQLite BLOB ではなくディスク上のファイルとして保存する。

```
~/.trpg-editor/            ← アプリデータルート
├── default.trpg           ← SQLite
└── media/
    ├── {uuid1}.jpg
    └── {uuid2}.jpg
```

DB の `media.rel_path` には `media/{uuid}.jpg`（アプリデータルートからの相対パス）を格納する。  
`media.mime` は入力形式に関わらず `image/jpeg` 固定。

---

## 2. Go 側設計

### 2.1 パッケージ構成

```
internal/media/
├── import.go   — 取り込みパイプライン + List
└── handler.go  — AssetServer HTTP ハンドラ
```

### 2.2 import.go

**外部依存**:
- `golang.org/x/image/draw` — Lanczos 品質リサイズ（`draw.CatmullRom`）
- `golang.org/x/image/webp` — WebP デコード（エンコードは標準 JPEG を使用）

**Record 型**:

```go
type Record struct {
    ID            string
    ScenarioID    string
    Filename      string
    Mime          string  // 常に "image/jpeg"
    Width, Height int
    Bytes         int
    RelPath       string  // "media/{id}.jpg"
}
```

**取り込みパイプライン**（`importImage` 内部関数）:

1. ファイル先頭 512 バイトで `http.DetectContentType` による MIME 検出
   - `image/jpeg`, `image/png`, `image/webp` 以外はエラー返却
2. `image.Decode`（JPEG/PNG は標準ライブラリ、WebP は `golang.org/x/image/webp.Decode`）
3. アルファチャンネルがある場合は白背景 (`image.NewRGBA`) に合成
4. 長辺 > 1200px の場合のみ `draw.CatmullRom` でリサイズ（アスペクト比保持）
5. `jpeg.Encode(file, img, &jpeg.Options{Quality: 85})`
6. `media` テーブルへ INSERT（重複 ID は UUID v4 で回避）

**公開関数**:

```go
func ImportFromPath(db *sql.DB, mediaDir, scenarioID, srcPath string) (Record, error)
func ImportFromBytes(db *sql.DB, mediaDir, scenarioID, filename string, data []byte) (Record, error)
func List(db *sql.DB, scenarioID string) ([]Record, error)
```

### 2.3 handler.go

```go
type Handler struct {
    db       *sql.DB
    mediaDir string
}

func New(db *sql.DB, mediaDir string) *Handler
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request)
```

- パス形式: `/media/{id}`
- DB から `rel_path` を引いてファイルパスを解決し `http.ServeContent` で返す
- ファイルが見つからない場合は 404
- DB が未初期化の場合は 503

### 2.4 main.go の変更点

Wails オプションに以下を追加：

```go
DragAndDrop: &options.DragAndDrop{
    EnableFileDrop:     true,
    DisableWebkitDrop:  true,  // WebKit 標準のドロップ動作を無効化
},
AssetServer: &assetserver.Options{
    Assets:  assets,
    Handler: http.HandlerFunc(app.serveMedia),
},
```

`app.serveMedia` は `App` のメソッドで、`app.mediaHandler` が nil（起動前）の場合に 503 を返す。

### 2.5 app.go の追加メソッド

```go
func (a *App) ImportMediaFromPath(scenarioID, path string) (media.Record, error)
func (a *App) ImportMediaFromBytes(scenarioID, filename string, data []byte) (media.Record, error)
func (a *App) ListMedia(scenarioID string) ([]media.Record, error)
func (a *App) serveMedia(w http.ResponseWriter, r *http.Request)  // private
```

`startup()` 内で `mediaDir` を解決（`.trpg` と同じ `~/.trpg-editor/media`）して `media.New` で初期化。

---

## 3. フロントエンド設計

### 3.1 `![[media:id]]` インライン構文

**パーサ**: `frontend/src/editor/markdown-ext.ts`（新規作成）

CM6 の `InlineParser` として実装。パターン: `![[media:{id}]]`

```typescript
export const mediaImageParser: MarkdownConfig = {
  defineNodes: [{ name: "MediaImage", style: t.url }],
  parseInline: [{
    name: "MediaImage",
    parse(cx, next, pos) {
      // '!' + '[' + '[' + 'media:' の順に一致確認
      // ']]' を終端として検索、ノードを追加
    },
  }],
};
```

`setup.ts` の `markdown({ base: markdownLanguage, extensions: [mediaImageParser] })` に登録。

### 3.2 `widgets/ImageWidget.ts`（新規作成）

```typescript
export class ImageWidget extends WidgetType {
  constructor(readonly mediaId: string) { super(); }

  eq(other: WidgetType): boolean {
    return other instanceof ImageWidget && other.mediaId === this.mediaId;
  }

  toDOM(_view: EditorView): HTMLElement {
    const img = document.createElement("img");
    img.src = `/media/${this.mediaId}`;
    img.loading = "lazy";
    img.className = "media-image";
    img.alt = `media:${this.mediaId}`;
    img.style.maxWidth = "100%";
    return img;
  }

  ignoreEvent(_event: Event): boolean { return false; }
}
```

### 3.3 `live-preview.ts` の拡張

既存のディレクティブ装飾ループに加えて、可視範囲内の `![[media:...]]` を検索して `ImageWidget` に置換するロジックを追加。

- `MEDIA_RE = /!\[\[media:([a-zA-Z0-9\-]+)\]\]/g` で正規表現スキャン
- カーソルが `[from, to]` 内に入っている間は生テキストを維持（ディレクティブと同じロジック）
- カーソルが範囲外なら `Decoration.replace({ widget: new ImageWidget(id) })` を適用
- `view.composing` が true の間は更新をスキップ（IME 保護）

### 3.4 D&D: `editor/mediaDrop.ts`（新規作成）

```typescript
import { OnFileDrop } from "../../wailsjs/runtime/runtime";
import { importMediaFromPath } from "../api/bindings";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function setupMediaDrop(view: EditorView, scenarioId: string): () => void {
  OnFileDrop(async (x, y, paths) => {
    const path = paths[0];
    if (!path) return;
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return;

    try {
      const record = await importMediaFromPath(scenarioId, path);
      const pos = view.posAtCoords({ x, y }) ?? view.state.doc.length;
      view.dispatch({
        changes: { from: pos, insert: `![[media:${record.id}]]` },
      });
    } catch (err) {
      console.error("media import failed:", err);
    }
  }, true);

  return () => OnFileDropOff();
}
```

エディタルート要素に `data-wails-drop-target="true"` 属性を付与して、エディタ外のドロップを無視する。

### 3.5 `setup.ts` の変更

`createEditorView` の返り値として view を返した後、呼び出し元（`App.tsx` またはエディタコンポーネント）から `setupMediaDrop(view, scenarioId)` を呼び出す。  
アンマウント時に返り値のクリーンアップ関数を呼び出す。

### 3.6 `api/bindings.ts` の追加

```typescript
export type MediaRecord = media.Record;

export const importMediaFromPath = (scenarioID: string, path: string) =>
  _ImportMediaFromPath(scenarioID, path);

export const importMediaFromBytes = (scenarioID: string, filename: string, data: number[]) =>
  _ImportMediaFromBytes(scenarioID, filename, data);

export const listMedia = (scenarioID: string) =>
  _ListMedia(scenarioID);
```

---

## 4. データフロー

```
[ユーザーが画像をドロップ]
         ↓
Wails OnFileDrop(x, y, ["/path/to/image.png"])
         ↓
frontend: importMediaFromPath(scenarioID, path)
         ↓ (Wails binding)
Go: App.ImportMediaFromPath → media.ImportFromPath
    - MIME検出
    - decode → resize → JPEG encode
    - ~/.trpg-editor/media/{id}.jpg に保存
    - DB INSERT
    - Return Record{ID, ...}
         ↓
frontend: view.dispatch( insert `![[media:{id}]]` at posAtCoords )
         ↓
live-preview: ImageWidget → <img src="/media/{id}" loading="lazy">
         ↓
Wails AssetServer: /media/{id} → media.Handler → http.ServeContent
```

---

## 5. 未対応スコープ（意図的に除外）

- 画像の削除 UI（孤立メディアのクリーンアップ）
- `ListMedia` を使ったメディア一覧パネル
- クリップボードからの貼り付け（`ImportMediaFromBytes` を使えば将来追加可能）
- PDF/HTML エクスポート時の画像埋め込み（M5 スコープ）

---

## 6. 依存パッケージの追加

```bash
go get golang.org/x/image
```

`go.mod` に `golang.org/x/image` が追加される（`draw`, `webp` サブパッケージを含む）。
