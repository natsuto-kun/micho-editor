# TRPG シナリオエディタ 技術構成・開発ドキュメント

**構成**: Wails v2 (Go) + React + TypeScript + CodeMirror 6 + SQLite
**想定規模**: 1シナリオあたり 10〜20万字（100ページ級）、メディア数十点

---

## 1. 何を作るか

TRPG のシナリオを執筆・管理するローカルデスクトップアプリ。

- 執筆中はアウトライン・NPC・ハンドアウトを行き来しながら書く
- セッション当日は「進行用ビュー」として読む
- 完成したら配布用の Markdown / HTML / PDF に出力する

この3つのモードを1つのデータから作るのが設計の軸になる。

### 要件

| # | 要件 | 設計への影響 |
|---|---|---|
| R1 | 10〜20万字を破綻なく編集できる | CM6 のビューポート仮想化 + セクション分割 |
| R2 | NPC・ハンドアウト等を構造として持てる | Markdown ディレクティブ記法 + パーサ |
| R3 | 日本語全文検索が速い | SQLite FTS5 (trigram tokenizer) |
| R4 | オフライン完結・単一ファイルで持ち運べる | SQLite 1ファイル = 1プロジェクト |
| R5 | 日本語入力が快適 | IME composition 中の再描画を抑制 |
| R6 | クロスプラットフォーム配布 | pure Go SQLite ドライバ（CGO 不要） |

---

## 2. 技術スタック

| レイヤー | 採用 | 理由 |
|---|---|---|
| デスクトップ基盤 | Wails v2 | Go をそのままバックエンドにできる。Chromium 非同梱でバイナリ・メモリが軽い |
| フロントエンド | React + TypeScript | 周辺 UI（アウトライン、検索、設定）の状態管理向け |
| エディタコア | **CodeMirror 6** | ビューポート仮想化が組み込み。長文でも入力レイテンシが劣化しない |
| Markdown パース | @lezer/markdown | CM6 のインクリメンタルパーサ。独自記法を拡張可能 |
| 状態管理 | Zustand | 本文以外のメタ状態のみを持つ。細粒度購読 |
| 永続化 | SQLite (modernc.org/sqlite) | CGO 不要。FTS5 利用可 |
| 検索 | FTS5 + trigram | 日本語を分かち書きなしで部分一致検索できる |
| 出力 | goldmark | Go 側で Markdown → HTML。独自記法もレンダラ拡張で対応 |

### CodeMirror 6 を選ぶということの意味

CM6 は **プレーンテキスト（Markdown）を編集し、装飾はデコレーションで被せる** アーキテクチャ。ProseMirror 系のような「構造化ドキュメント JSON」ではない。

これは以下のトレードオフを受け入れる判断になる。

**得られるもの**
- 20万字を1インスタンスに載せても入力が重くならない（可視範囲のみ DOM 化）
- データの実体がただのテキストなので、Git 管理・grep・他ツールとの相互運用が容易
- 保存が単純な文字列 UPDATE で済み、差分計算もテキスト diff がそのまま使える
- バンドルサイズが小さい

**諦めるもの**
- 完全な WYSIWYG。テーブル編集は「Markdown の表記法を書く」体験になる
- 構造の強制。壊れた記法を書けてしまうので、パーサ側の寛容さが必要

TRPG シナリオは「執筆」の比重が高く、Word 的な自由レイアウトは要らない。**Obsidian のライブプレビューに近い体験** を目標にすれば CM6 は最適解になる。

---

## 3. アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  WebView (WKWebView / WebView2 / WebKitGTK)     │
│                                                  │
│  React                                           │
│   ├─ SidebarOutline    ← Zustand (メタのみ)      │
│   ├─ EditorPane        ← CodeMirror 6            │
│   │    ├─ markdown() + 独自 MarkdownConfig       │
│   │    ├─ ViewPlugin: ライブプレビュー装飾        │
│   │    ├─ autocompletion: @NPC / #tag 補完        │
│   │    └─ updateListener: デバウンス保存          │
│   ├─ SearchPanel       ← FTS5 結果               │
│   └─ SessionView       ← 読み取り専用レンダリング  │
└────────────────┬────────────────────────────────┘
                 │ Wails binding (JSON) / EventsEmit
┌────────────────┴────────────────────────────────┐
│  Go                                              │
│   ├─ app.go          公開 API                    │
│   ├─ internal/store/    SQLite (sections, media) │
│   ├─ internal/search/   FTS5 クエリ              │
│   ├─ internal/render/   goldmark → HTML/PDF      │
│   ├─ internal/media/    画像の取り込み・配信       │
│   └─ internal/history/  スナップショット           │
└─────────────────────────────────────────────────┘
                 │
          scenario.trpg (SQLite ファイル)
```

### セクション分割モデル

CM6 単体なら20万字を1インスタンスで扱えるが、**それでもセクション分割はする**。理由は編集性能ではなく以下。

1. 保存が「変更されたセクション1行の UPDATE」で済む → IPC も DB 書き込みも小さい
2. 検索結果が「どのシーンにあるか」の単位で返る → UI が自然
3. 履歴スナップショットの粒度が細かくなり、容量が小さい
4. セクション並び替え = `sort_key` の更新だけ

エディタには**開いているセクション1つだけ**をロードする。ただし「シナリオ全体を1画面で通し読みしたい」という要求は必ず出るので、**連結ビュー**（全セクションを結合した読み取り専用の CM6 インスタンス）を別途用意する。ここで CM6 の仮想化が効いて、20万字でもスクロールが滑らかになる。

---

## 4. ディレクトリ構成

```
trpg-editor/
├── main.go                     # Wails エントリポイント
├── app.go                      # フロントに公開する API
├── internal/
│   ├── store/
│   │   ├── db.go               # 接続・PRAGMA・マイグレーション
│   │   ├── scenario.go
│   │   ├── section.go
│   │   └── migrations/
│   │       ├── 0001_init.sql
│   │       └── 0002_fts.sql
│   ├── search/
│   │   └── fts.go
│   ├── media/
│   │   ├── import.go           # 画像取り込み・リサイズ
│   │   └── handler.go          # AssetServer ハンドラ
│   ├── render/
│   │   ├── goldmark.go         # 独自記法の AST 拡張
│   │   └── export.go           # HTML / PDF 出力
│   └── history/
│       └── snapshot.go
└── frontend/
    └── src/
        ├── editor/
        │   ├── setup.ts            # CM6 拡張の組み立て
        │   ├── markdown-ext.ts     # @lezer/markdown 拡張
        │   ├── live-preview.ts     # デコレーション ViewPlugin
        │   ├── widgets/            # NPCWidget, ImageWidget など
        │   ├── completion.ts       # @NPC / #tag 補完
        │   └── autosave.ts
        ├── components/
        │   ├── Outline.tsx
        │   ├── SearchPanel.tsx
        │   └── SessionView.tsx
        ├── stores/
        │   ├── scenarioStore.ts    # メタ情報のみ
        │   └── uiStore.ts
        └── api/
            └── bindings.ts         # Wails バインディングのラッパー
```

**原則**: 本文テキストは Zustand に置かない。CM6 の `EditorState` に閉じ込め、ストアにはセクションID・タイトル・dirty フラグ・更新時刻だけを置く。これを守らないと、キー入力のたびにサイドバー全体が再レンダリングされる。

---

## 5. データモデル

```sql
-- 0001_init.sql

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE scenarios (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  system      TEXT,                    -- CoC7, SW2.5, エモクロア 等
  players     TEXT,                    -- "3〜4人"
  play_time   TEXT,                    -- "3〜4時間"
  meta        TEXT NOT NULL DEFAULT '{}',  -- 自由項目 JSON
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE sections (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES sections(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,           -- intro / scene / npc / handout / appendix
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  sort_key    TEXT NOT NULL,           -- fractional indexing ("a0", "a0V", "a1")
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_sections_scenario ON sections(scenario_id, sort_key);
CREATE INDEX idx_sections_parent   ON sections(parent_id, sort_key);

CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER NOT NULL,
  rel_path    TEXT NOT NULL,           -- BLOB ではなくファイル参照
  created_at  INTEGER NOT NULL
);

CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,
  body_gz     BLOB NOT NULL,           -- gzip 圧縮した本文
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_snapshots_section ON snapshots(section_id, created_at DESC);

-- セクション間リンク（[[シーン3]] 記法から生成）
CREATE TABLE links (
  from_id     TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
);
```

### 全文検索（日本語対応が肝）

```sql
-- 0002_fts.sql

CREATE VIRTUAL TABLE section_fts USING fts5(
  title,
  body,
  content='sections',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO section_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO section_fts(section_fts, rowid, title, body)
    VALUES('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO section_fts(section_fts, rowid, title, body)
    VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO section_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;
```

**`tokenize='trigram'` が重要。** デフォルトの `unicode61` は空白区切りでトークン化するため、日本語では「文章まるごと1トークン」になり部分一致検索が機能しない。trigram トークナイザは3文字単位でインデックスを作るので、分かち書き（MeCab 等）なしで日本語の部分一致が効く。

トレードオフとして、インデックスサイズが本文の2〜3倍になり、2文字以下のクエリでは LIKE にフォールバックする必要がある。シナリオ数十本の規模なら容量は問題にならない。

`content='sections'` の external content 方式にすることで、本文をFTS側に二重保存しないで済む。

---

## 6. CodeMirror 6 の構成

### 6.1 拡張の組み立て

```ts
// frontend/src/editor/setup.ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, drawSelection } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";

import { trpgMarkdown } from "./markdown-ext";
import { livePreview } from "./live-preview";
import { trpgCompletion } from "./completion";
import { autosave } from "./autosave";
import { scenarioTheme, scenarioHighlight } from "./theme";

export function createEditorState(doc: string, sectionId: string) {
  return EditorState.create({
    doc,
    extensions: [
      EditorView.lineWrapping,
      history({ minDepth: 50, newGroupDelay: 300 }),
      drawSelection(),
      highlightActiveLine(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),

      markdown({
        base: markdownLanguage,
        extensions: [trpgMarkdown],   // 独自記法
        codeLanguages: [],            // シナリオでは不要なので読み込まない
      }),
      syntaxHighlighting(scenarioHighlight),

      livePreview,                    // 装飾（可視範囲限定）
      autocompletion({ override: [trpgCompletion] }),
      autosave(sectionId),
      scenarioTheme,
    ],
  });
}
```

`history` の `minDepth` は明示的に絞る。長時間の執筆セッションでトランザクションがメモリに積み上がるのを防ぐ。

### 6.2 独自 Markdown 記法

TRPG シナリオに必要な構造を、ディレクティブ記法で表現する。

```markdown
:::npc 田中 誠一 | 探偵 | 45歳
STR 12 / CON 14 / POW 16 / SAN 65
初期状態は非協力的。[[シーン2]]で説得に成功すると同行する。
:::

:::handout HO1 | 探索者A
あなたは3日前から悪夢を見ている。
:::

:::check 図書館 難易度:通常
成功 → [[シーン4]] へ
失敗 → 手がかりを1つ失い [[シーン3]] へ戻る
:::

:::secret
真犯人は依頼人本人。セッション中はPLに見せないこと。
:::

> [!warning] GM注意
> ここでSAN値チェックが入る。事前に残SANを確認しておく。
```

`@lezer/markdown` の `MarkdownConfig` として実装する。

```ts
// frontend/src/editor/markdown-ext.ts
import { MarkdownConfig, BlockContext, Line } from "@lezer/markdown";
import { tags as t, Tag } from "@lezer/highlight";

export const directiveTag = Tag.define();
export const secretTag = Tag.define();
export const wikiLinkTag = Tag.define();

const DIRECTIVE_OPEN = /^:::(npc|handout|check|secret|box)\s*(.*)$/;

export const trpgMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: "Directive",      block: true, style: directiveTag },
    { name: "DirectiveMark",  style: t.processingInstruction },
    { name: "DirectiveName",  style: t.keyword },
    { name: "DirectiveArgs",  style: t.attributeValue },
    { name: "WikiLink",       style: wikiLinkTag },
  ],

  parseBlock: [{
    name: "Directive",
    parse(cx: BlockContext, line: Line): boolean {
      const m = DIRECTIVE_OPEN.exec(line.text.slice(line.pos));
      if (!m) return false;

      const start = cx.lineStart + line.pos;
      const children = [
        cx.elt("DirectiveMark", start, start + 3),
        cx.elt("DirectiveName", start + 3, start + 3 + m[1].length),
      ];
      if (m[2]) {
        const argStart = start + 3 + m[1].length;
        children.push(cx.elt("DirectiveArgs", argStart, start + line.text.length));
      }

      // 閉じ ::: まで読み進める
      while (cx.nextLine()) {
        if (/^:::\s*$/.test(cx.line.text)) {
          const end = cx.lineStart + cx.line.text.length;
          children.push(cx.elt("DirectiveMark", cx.lineStart, cx.lineStart + 3));
          cx.addElement(cx.elt("Directive", start, end, children));
          cx.nextLine();
          return true;
        }
      }
      // 閉じられていない場合も文書末まででノード化する（寛容に扱う）
      cx.addElement(cx.elt("Directive", start, cx.lineStart, children));
      return true;
    },
  }],

  parseInline: [{
    name: "WikiLink",
    parse(cx, next, pos) {
      if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1;
      const end = cx.slice(pos, cx.end).indexOf("]]");
      if (end < 0) return -1;
      return cx.addElement(cx.elt("WikiLink", pos, pos + end + 2));
    },
  }],
};
```

同じ記法を Go 側の goldmark でも解釈できるようにしておく。**フロント（編集時プレビュー）と Go（エクスポート）で2箇所実装することになる** ので、記法の仕様は独立したドキュメントに切り出し、両方から参照する。

### 6.3 ライブプレビュー（デコレーション）

**ここが唯一のパフォーマンス上の要注意ポイント。** 必ず `view.visibleRanges` に限定する。

```ts
// frontend/src/editor/live-preview.ts
import { ViewPlugin, Decoration, DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { NpcWidget, ImageWidget } from "./widgets";

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const cursor = state.selection.main.head;

  // ★ 可視範囲のみ走査する。doc 全体を iterate すると文書長に比例して重くなる
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        if (node.name !== "Directive") return;

        // カーソルがブロック内にあるときは生の記法を表示（Obsidian 的ライブプレビュー）
        if (cursor >= node.from && cursor <= node.to) return;

        const raw = state.doc.sliceString(node.from, node.to);
        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new NpcWidget(raw),
            block: true,
          })
        );
      },
    });
  }
  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      // IME 変換中は再構築しない（カーソル移動で装飾が入れ替わると変換が壊れる）
      if (u.view.composing) return;
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  }
);
```

`atomicRanges` を提供すると、置換ウィジェット内をカーソルが通り抜けず、矢印キーで一気に飛び越えられる。これがないと編集体験が悪くなる。

### 6.4 画像ウィジェット

画像は Wails の AssetServer 経由で配信し、`![[media:xxxx]]` を `<img>` ウィジェットに置換する。base64 埋め込みは絶対に避ける。

```ts
export class ImageWidget extends WidgetType {
  constructor(readonly mediaId: string) { super(); }
  eq(other: ImageWidget) { return other.mediaId === this.mediaId; }
  toDOM() {
    const img = document.createElement("img");
    img.src = `/media/${this.mediaId}`;   // Go の AssetServer が返す
    img.loading = "lazy";
    img.className = "cm-scenario-image";
    return img;
  }
}
```

### 6.5 補完（@NPC / [[リンク]] / #タグ）

```ts
// frontend/src/editor/completion.ts
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { useScenarioStore } from "../stores/scenarioStore";

export async function trpgCompletion(ctx: CompletionContext): Promise<CompletionResult | null> {
  const wiki = ctx.matchBefore(/\[\[[^\]]*/);
  if (wiki) {
    const sections = useScenarioStore.getState().sections; // メタのみ保持
    return {
      from: wiki.from + 2,
      options: sections.map((s) => ({
        label: s.title,
        detail: s.kind,
        type: "class",
      })),
      validFor: /^[^\]]*$/,
    };
  }

  const tag = ctx.matchBefore(/#[^\s#]*/);
  if (tag) {
    const tags = useScenarioStore.getState().tags;
    return {
      from: tag.from + 1,
      options: tags.map((t) => ({ label: t, type: "keyword" })),
      validFor: /^[^\s#]*$/,
    };
  }

  return null;
}
```

補完候補は Go を叩かず、起動時にロードしたメタ情報から引く。セクション数百件程度ならメモリに全部載る。

### 6.6 オートセーブ

```ts
// frontend/src/editor/autosave.ts
import { EditorView } from "@codemirror/view";
import { SaveSection } from "../../wailsjs/go/main/App";
import { useScenarioStore } from "../stores/scenarioStore";

const IDLE_MS = 800;
const MAX_INTERVAL_MS = 5000;

export function autosave(sectionId: string) {
  let timer: number | undefined;
  let firstDirtyAt = 0;

  const flush = (view: EditorView) => {
    window.clearTimeout(timer);
    timer = undefined;
    firstDirtyAt = 0;
    const body = view.state.doc.toString();
    const rev = useScenarioStore.getState().revOf(sectionId);
    SaveSection(sectionId, body, rev)
      .then((res) => useScenarioStore.getState().markSaved(sectionId, res.rev))
      .catch((e) => useScenarioStore.getState().markSaveError(sectionId, String(e)));
  };

  return EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    if (u.view.composing) return;          // IME 変換確定前は保存しない

    useScenarioStore.getState().markDirty(sectionId);
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;

    // 打ち続けている間も最大 5 秒に1回は必ず保存する
    if (now - firstDirtyAt >= MAX_INTERVAL_MS) {
      flush(u.view);
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flush(u.view), IDLE_MS);
  });
}
```

加えて、以下のタイミングでも flush する。

- セクション切り替え時（アンマウント前）
- ウィンドウの blur / フォーカスロスト
- Wails の `BeforeClose` フックから `EventsEmit` → フロントが flush → 応答を待って終了

---

## 7. Go 側 API 設計

```go
// app.go
package main

type App struct {
    ctx   context.Context
    store *store.Store
}

// --- シナリオ ---
func (a *App) OpenScenario(path string) (store.Scenario, error)
func (a *App) CreateScenario(path, title, system string) (store.Scenario, error)
func (a *App) UpdateScenarioMeta(id string, meta store.ScenarioMeta) error

// --- セクション ---
func (a *App) ListSections(scenarioID string) ([]store.SectionMeta, error) // body を含まない
func (a *App) GetSection(id string) (store.Section, error)
func (a *App) SaveSection(id, body string, rev int) (store.SaveResult, error)
func (a *App) CreateSection(scenarioID, parentID, kind, title, afterID string) (store.SectionMeta, error)
func (a *App) MoveSection(id, newParentID, afterID string) error
func (a *App) DeleteSection(id string) error

// --- 検索 ---
func (a *App) Search(scenarioID, query string, limit int) ([]search.Hit, error)

// --- メディア ---
func (a *App) ImportMediaFromPath(scenarioID, srcPath string) (store.Media, error)
func (a *App) ImportMediaFromBytes(scenarioID, filename string, data []byte) (store.Media, error)
func (a *App) ListMedia(scenarioID string) ([]store.Media, error)

// --- 履歴 ---
func (a *App) ListSnapshots(sectionID string) ([]store.SnapshotMeta, error)
func (a *App) GetSnapshot(id string) (string, error)

// --- 出力 ---
func (a *App) ExportHTML(scenarioID, outPath string, opt render.Options) error
func (a *App) ExportMarkdown(scenarioID, outPath string, opt render.Options) error
func (a *App) ExportPDF(scenarioID, outPath string, opt render.Options) error
```

### 設計上のルール

**1. `ListSections` は本文を返さない。** セクション一覧に body を含めると、起動時に20万字が JSON でシリアライズされて IPC を通る。メタだけ返し、本文は開くときに `GetSection` で個別に取る。

**2. `SaveSection` は rev で楽観ロックする。**

```go
func (s *Store) SaveSection(id, body string, rev int) (SaveResult, error) {
    res, err := s.db.Exec(`
        UPDATE sections
           SET body = ?, rev = rev + 1, updated_at = ?
         WHERE id = ? AND rev = ?`,
        body, time.Now().UnixMilli(), id, rev)
    if err != nil {
        return SaveResult{}, err
    }
    n, _ := res.RowsAffected()
    if n == 0 {
        return SaveResult{Conflict: true}, nil  // 別ウィンドウ等で更新されている
    }
    return SaveResult{Rev: rev + 1}, nil
}
```

**3. 検索は SQL 側で snippet を作る。**

```go
func (s *Store) Search(scenarioID, q string, limit int) ([]Hit, error) {
    rows, err := s.db.Query(`
        SELECT sec.id, sec.title, sec.kind,
               snippet(section_fts, 1, '<mark>', '</mark>', '…', 24) AS snip,
               bm25(section_fts) AS score
          FROM section_fts
          JOIN sections sec ON sec.rowid = section_fts.rowid
         WHERE section_fts MATCH ?
           AND sec.scenario_id = ?
         ORDER BY score
         LIMIT ?`, q, scenarioID, limit)
    // ...
}
```

trigram トークナイザは2文字以下のクエリを扱えないため、フロント側で「2文字以上入力されたら FTS、それ未満はタイトルの LIKE 検索」に振り分ける。

**4. メディアは AssetServer で配信する。**

```go
// main.go
err := wails.Run(&options.App{
    Title:  "TRPG Scenario Editor",
    Width:  1400,
    Height: 900,
    AssetServer: &assetserver.Options{
        Assets:  assets,
        Handler: media.NewHandler(app.Store()),  // /media/{id} を処理
    },
    OnStartup:    app.startup,
    OnBeforeClose: app.beforeClose,   // 未保存のフラッシュを待つ
    Bind: []interface{}{app},
})
```

---

## 8. 出力（エクスポート）

goldmark に同じディレクティブ記法のパーサ拡張を実装し、AST を経由して出力する。

```go
// internal/render/goldmark.go
md := goldmark.New(
    goldmark.WithExtensions(
        extension.GFM,
        NewDirectiveExtension(),   // :::npc 等
        NewWikiLinkExtension(sectionIndex),
    ),
    goldmark.WithRendererOptions(html.WithUnsafe()),
)
```

### 出力バリエーション

| モード | `:::secret` | GM注記 | 用途 |
|---|---|---|---|
| GM版 | 表示 | 表示 | 自分用・共同GM用 |
| PL配布版 | **除去** | 除去 | セッション後の公開・シナリオ販売 |
| ハンドアウトのみ | 除去 | 除去 | PLへの事前配布 |

`render.Options` にフラグを持たせ、AST walk 時にノードを落とす。**シークレット情報を落とし忘れると事故になる** ので、ここは Go 側でユニットテストを厚めに書く。

PDF は、まず HTML を出して WebView の印刷機能に流すのが最も低コスト。品質にこだわるなら別途 wkhtmltopdf 等の同梱を検討するが、配布バイナリが重くなるので後回しでよい。

---

## 9. パフォーマンス指針

| 項目 | 目標 | 検証方法 |
|---|---|---|
| 起動 → 編集可能 | < 1.0s | 500セクション/20万字のダミーで計測 |
| キー入力レイテンシ | < 16ms | Chrome DevTools の Performance（WebView でも接続可） |
| セクション切り替え | < 100ms | `GetSection` + `EditorState.create` |
| 全文検索応答 | < 50ms | FTS5 の EXPLAIN QUERY PLAN 確認 |
| 保存 1回 | < 30ms | WAL 有効時の UPDATE |
| メモリ常駐 | < 300MB | WebView 分を含む |

### やってはいけないことリスト

- ❌ `syntaxTree(state).iterate()` を可視範囲以外で回す
- ❌ 本文文字列を Zustand / React state に持つ
- ❌ 画像を base64 でドキュメントに埋め込む
- ❌ キーストロークごとに Go を呼ぶ
- ❌ `ListSections` で body を返す
- ❌ `history` の深さを無制限にする
- ❌ アウトライン再生成を `docChanged` のたびに実行する（デバウンス必須）

---

## 10. WebView 固有の注意点

### 10.1 日本語 IME（最優先で検証すること）

CM6 は composition を正しく扱うが、**その上に載せた自前のロジックが壊す**。

- `view.composing` が true の間は、デコレーション再構築・保存・トランザクション dispatch を行わない
- `compositionstart` / `compositionend` の発火タイミングは WKWebView と WebView2 で差がある。変換確定直後に `docChanged` が来るケースと来ないケースの両方を想定する
- 変換中にウィジェット置換が入れ替わるとカーソルが飛ぶ。上記コードの `if (u.view.composing) return;` はこの対策

**プロトタイプ最初の1週間で、macOS / Windows 両方で日本語入力を実機確認すること。** ブラウザで動いたことは何の保証にもならない。

### 10.2 その他

- `window.prompt` / `alert` は WebView で挙動が異なる。最初から React のモーダルで作る
- ドラッグ&ドロップされたファイルのパス取得は、Wails の `OnFileDrop` を使う（`DataTransfer` からはパスが取れない）
- Windows は WebView2 ランタイムが必要。Windows 11 は同梱済みだが、Windows 10 向けにはブートストラップを配布に含める
- Linux の WebKitGTK はバージョン差が大きい。優先度は macOS → Windows → Linux

---

## 11. 開発ロードマップ

| マイルストーン | 内容 | 完了条件 |
|---|---|---|
| **M0 骨格** | Wails + React + CM6 の起動、SQLite 接続、マイグレーション | 空のエディタが起動して文字が打てる |
| **M0.5 IME検証** | macOS / Windows で日本語入力を実機確認 | 変換が壊れない・カーソルが飛ばない |
| **M1 編集基盤** | セクション CRUD、アウトライン、オートセーブ、楽観ロック | 20万字ダミーで入力レイテンシ 16ms 以下 |
| **M2 検索** | FTS5 + trigram、検索パネル、ヒットジャンプ | 500セクションで 50ms 以下 |
| **M3 独自記法** | `:::npc` 等のパーサ + ライブプレビュー + 補完 | NPC/ハンドアウトが装飾表示される |
| **M4 メディア** | 画像取り込み、AssetServer 配信、ウィジェット表示 | D&D で画像が貼れる |
| **M5 出力** | GM版 / PL配布版 の HTML・Markdown 出力 | secret の除去がテストで保証される |
| **M6 セッションビュー** | 読み取り専用ビュー、連結ビュー、シークレットのトグル | 全文スクロールが滑らか |
| **M7 履歴** | スナップショット、差分表示、復元 | 任意の版に戻せる |
| **M8 配布** | 署名・公証（macOS）、インストーラ（Windows） | 他人の PC で起動する |

M0.5 を独立したマイルストーンにしているのは意図的。ここで問題が出た場合、エディタコアの選定自体を見直す必要があるため、実装が積み上がる前に判定する。

---

## 12. 主要な依存パッケージ

### Go

```
github.com/wailsapp/wails/v2
modernc.org/sqlite
github.com/yuin/goldmark
github.com/yuin/goldmark/extension
github.com/google/uuid
golang.org/x/image/draw       // サムネイル生成
```

### フロントエンド

```
@codemirror/state
@codemirror/view
@codemirror/commands
@codemirror/language
@codemirror/lang-markdown
@codemirror/autocomplete
@codemirror/search
@lezer/markdown
@lezer/highlight
react / react-dom
zustand
```

CM6 は個別パッケージのバージョン整合が崩れると型エラーやランタイムエラーになりやすい。`@codemirror/state` と `@codemirror/view` が重複インストールされていないか、`npm ls @codemirror/state` で定期的に確認する。

---

## 13. 将来の拡張余地

- **共同編集**: CM6 + Yjs（`y-codemirror.next`）。Yjs の更新をバイナリで SQLite に追記ログとして貯める。スキーマに `section_updates` テーブルを足せるよう、今の段階で ID 設計だけ揃えておく
- **ダイスロール連携**: `:::check` ブロックからセッションビューでロールを実行し、結果をログに残す
- **シナリオテンプレート**: システム別（CoC7 / SW2.5 等）の雛形をセクション構成ごと生成
- **リンクグラフ**: `links` テーブルから React Flow でシーン遷移図を描画。行き止まりや到達不能シーンの検出に使える

最後の項目は、参照元記事の React Flow がそのまま活きる部分。シナリオの構造をノードグラフで俯瞰できると、フローの破綻に気づきやすくなる。
