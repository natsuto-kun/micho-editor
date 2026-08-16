# M3 独自記法 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `:::npc` / `:::handout` / `:::secret` ブロックをライブプレビューウィジェットとして表示し、`[[WikiLink]]` / `@NPC` / `#tag` / `:::` のオートコンプリートを実装する。

**Architecture:** Regex ベース ViewPlugin（lezer パーサ拡張なし）。`directive-parser.ts` で可視範囲をスキャンして DirectiveBlock を検出し、カーソルがブロック外の場合のみ WidgetDecoration で置き換える。オートコンプリートは単一 CompletionSource 関数で4種のトリガーを処理する。

**Tech Stack:** `@codemirror/view` (ViewPlugin, WidgetType, Decoration), `@codemirror/state` (Text, RangeSetBuilder), `@codemirror/autocomplete` (CompletionSource, autocompletion), Vitest

---

## ファイル構成

| 操作 | ファイル | 責務 |
|------|---------|------|
| 新規 | `frontend/src/editor/directive-parser.ts` | 純粋関数: doc + visibleRanges → DirectiveBlock[] |
| 新規 | `frontend/src/editor/directive-parser.test.ts` | vitest ユニットテスト |
| 新規 | `frontend/src/editor/completion.ts` | CompletionSource (:::, [[, @, #) |
| 新規 | `frontend/src/editor/widgets/NpcWidget.ts` | CM6 WidgetType: NPC テーブル |
| 新規 | `frontend/src/editor/widgets/HandoutWidget.ts` | CM6 WidgetType: Handout 青点線 |
| 新規 | `frontend/src/editor/widgets/SecretWidget.ts` | CM6 WidgetType: Secret グレーアウト |
| 新規 | `frontend/src/editor/widgets/widgets.css` | 全ウィジェット共通スタイル |
| 変更 | `frontend/src/editor/live-preview.ts` | directive-parser と Widget を組み込む |
| 変更 | `frontend/src/editor/setup.ts` | autocompletion + CSS import を追加 |
| 変更 | `frontend/vite.config.ts` | vitest 設定を追加 |
| 変更 | `frontend/package.json` | vitest 追加、test スクリプト追加 |

---

## Task 1: フィーチャーブランチ作成

**Files:** なし

- [ ] **Step 1: ブランチを作成**

```bash
git checkout -b feature/m3-custom-syntax
```

Expected: `Switched to a new branch 'feature/m3-custom-syntax'`

---

## Task 2: vitest セットアップ

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: vitest をインストール**

```bash
cd frontend && npm install -D vitest
```

Expected: `added N packages` (N は依存関係の数)

- [ ] **Step 2: `package.json` に test スクリプトを追加**

`frontend/package.json` の `scripts` に追加:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run"
},
```

- [ ] **Step 3: `vite.config.ts` に vitest 設定を追加**

現在の内容:
```typescript
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})
```

変更後:
```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: 動作確認（テストなしで実行）**

```bash
npm test
```

Expected: `No test files found` または `0 tests passed` (エラーなし)

---

## Task 3: `directive-parser.ts` — 純粋パース関数

**Files:**
- Create: `frontend/src/editor/directive-parser.ts`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/directive-parser.ts`:

```typescript
import { Text } from "@codemirror/state";

export interface DirectiveBlock {
  type: "npc" | "handout" | "secret";
  params: string;
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}

const START_RE = /^:::(npc|handout|secret)\s*(.*)/;
const END_RE = /^:::$/;

export function parseDirectiveBlocks(
  doc: Text,
  visibleRanges: readonly { from: number; to: number }[]
): DirectiveBlock[] {
  const blocks: DirectiveBlock[] = [];
  const processed = new Set<number>();

  for (const range of visibleRanges) {
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(Math.min(range.to, doc.length));

    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n);
      if (processed.has(line.from)) continue;

      const m = START_RE.exec(line.text);
      if (!m) continue;

      let closingLine: ReturnType<typeof doc.line> | null = null;
      for (let cn = n + 1; cn <= doc.lines; cn++) {
        const cl = doc.line(cn);
        if (END_RE.test(cl.text)) {
          closingLine = cl;
          break;
        }
      }
      if (!closingLine) continue;

      processed.add(line.from);
      blocks.push({
        type: m[1] as DirectiveBlock["type"],
        params: m[2].trim(),
        from: line.from,
        to: closingLine.to,
        bodyFrom: line.to + 1,
        bodyTo: closingLine.from - 1,
      });
      n = closingLine.number;
    }
  }

  return blocks;
}
```

---

## Task 4: `directive-parser.test.ts` — ユニットテスト

**Files:**
- Create: `frontend/src/editor/directive-parser.test.ts`
- Test: `frontend/src/editor/directive-parser.test.ts`

- [ ] **Step 1: テストファイルを作成**

`frontend/src/editor/directive-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { parseDirectiveBlocks } from "./directive-parser";

function makeDoc(content: string) {
  return Text.of(content.split("\n"));
}

function fullRange(doc: Text) {
  return [{ from: 0, to: doc.length }];
}

describe("parseDirectiveBlocks", () => {
  it("detects a basic npc block", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody text\n:::");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("npc");
    expect(blocks[0].params).toBe("田中 | 探偵 | 35");
    expect(doc.sliceString(blocks[0].bodyFrom, blocks[0].bodyTo)).toBe("body text");
  });

  it("detects handout and secret blocks", () => {
    const content = ":::handout HO1 | PlayerA\n内容\n:::\n:::secret\n秘密\n:::";
    const doc = makeDoc(content);
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("handout");
    expect(blocks[0].params).toBe("HO1 | PlayerA");
    expect(blocks[1].type).toBe("secret");
    expect(blocks[1].params).toBe("");
  });

  it("handles empty body", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\n:::");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(1);
    const body =
      blocks[0].bodyFrom <= blocks[0].bodyTo
        ? doc.sliceString(blocks[0].bodyFrom, blocks[0].bodyTo)
        : "";
    expect(body).toBe("");
  });

  it("ignores unclosed blocks", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody text");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));
    expect(blocks).toHaveLength(0);
  });

  it("returns nothing for plain text", () => {
    const doc = makeDoc("# 見出し\n本文テキスト");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));
    expect(blocks).toHaveLength(0);
  });

  it("scans only visible ranges", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody\n:::\n後続テキスト");
    // visible range covers only the last line
    const lastLine = doc.line(doc.lines);
    const blocks = parseDirectiveBlocks(doc, [
      { from: lastLine.from, to: lastLine.to },
    ]);
    expect(blocks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストを実行して全件パスを確認**

```bash
npm test
```

Expected: `6 passed` (全テスト PASS)

もし失敗した場合は `directive-parser.ts` を修正して再実行。

- [ ] **Step 3: コミット**

```bash
cd .. && git add frontend/src/editor/directive-parser.ts frontend/src/editor/directive-parser.test.ts frontend/vite.config.ts frontend/package.json frontend/package-lock.json && git commit -m "feat: M3 add directive-parser with vitest tests"
```

---

## Task 5: `widgets.css` — ウィジェットスタイル

**Files:**
- Create: `frontend/src/editor/widgets/widgets.css`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/widgets/widgets.css`:

```css
/* ── NPC ─────────────────────────────────────── */
.directive-npc {
  border: 1px solid #4a4a70;
  border-radius: 6px;
  overflow: hidden;
  margin: 4px 0;
  font-family: inherit;
}

.directive-npc__header {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #3a3a60;
  padding: 6px 12px;
  border-bottom: 1px solid #4a4a70;
}

.directive-npc__header .badge {
  background: #7c6af7;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 2px 7px;
  border-radius: 3px;
}

.directive-npc__header .name {
  color: #e2d9ff;
  font-size: 14px;
  font-weight: 700;
}

.directive-npc__attrs {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.directive-npc__attrs th {
  padding: 3px 10px;
  color: #888;
  font-weight: normal;
  border-right: 1px solid #3a3a60;
  border-bottom: 1px solid #3a3a60;
  width: 80px;
  text-align: left;
  background: #252540;
}

.directive-npc__attrs td {
  padding: 3px 10px;
  color: #ccc;
  border-bottom: 1px solid #3a3a60;
  background: #252540;
}

.directive-npc__attrs tr:last-child th,
.directive-npc__attrs tr:last-child td {
  border-bottom: none;
}

.directive-npc__body {
  padding: 8px 12px;
  color: #ccc;
  font-size: 13px;
  line-height: 1.6;
  background: #1e1e38;
}

/* ── Handout ──────────────────────────────────── */
.directive-handout {
  border: 2px dashed #3a6a9a;
  border-radius: 6px;
  overflow: hidden;
  margin: 4px 0;
  font-family: inherit;
}

.directive-handout__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px dashed #3a6a9a;
  background: #0a1a2a;
}

.directive-handout__header .badge {
  color: #6ab0e0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.directive-handout__header .id {
  color: #90d0f0;
  font-size: 14px;
  font-weight: 700;
}

.directive-handout__header .target {
  color: #999;
  font-size: 12px;
}

.directive-handout__body {
  padding: 8px 12px;
  color: #b0d8f0;
  font-size: 13px;
  line-height: 1.6;
  background: #0a1a2a;
}

/* ── Secret ───────────────────────────────────── */
.directive-secret {
  border-left: 4px solid #666;
  border-radius: 0 4px 4px 0;
  margin: 4px 0;
  opacity: 0.75;
  font-family: inherit;
  background: #111;
}

.directive-secret__label {
  padding: 4px 12px;
  color: #888;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
}

.directive-secret__body {
  padding: 4px 12px 8px;
  color: #aaa;
  font-size: 13px;
  line-height: 1.6;
}
```

---

## Task 6: `NpcWidget.ts`

**Files:**
- Create: `frontend/src/editor/widgets/NpcWidget.ts`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/widgets/NpcWidget.ts`:

```typescript
import { WidgetType } from "@codemirror/view";

export class NpcWidget extends WidgetType {
  constructor(
    readonly params: string,
    readonly body: string
  ) {
    super();
  }

  eq(other: NpcWidget): boolean {
    return other.params === this.params && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const [name = "", role = "", age = ""] = this.params
      .split("|")
      .map((p) => p.trim());

    const container = document.createElement("div");
    container.className = "directive-npc";

    const header = document.createElement("div");
    header.className = "directive-npc__header";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "NPC";

    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;

    header.append(badge, nameEl);

    const table = document.createElement("table");
    table.className = "directive-npc__attrs";

    for (const [label, value] of [
      ["役職", role],
      ["年齢", age],
    ] as [string, string][]) {
      if (!value) continue;
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = label;
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(th, td);
      table.append(tr);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-npc__body";
    bodyEl.textContent = this.body;

    container.append(header, table, bodyEl);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
```

---

## Task 7: `HandoutWidget.ts`

**Files:**
- Create: `frontend/src/editor/widgets/HandoutWidget.ts`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/widgets/HandoutWidget.ts`:

```typescript
import { WidgetType } from "@codemirror/view";

export class HandoutWidget extends WidgetType {
  constructor(
    readonly params: string,
    readonly body: string
  ) {
    super();
  }

  eq(other: HandoutWidget): boolean {
    return other.params === this.params && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const [id = "", target = ""] = this.params
      .split("|")
      .map((p) => p.trim());

    const container = document.createElement("div");
    container.className = "directive-handout";

    const header = document.createElement("div");
    header.className = "directive-handout__header";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "HANDOUT";

    const idEl = document.createElement("span");
    idEl.className = "id";
    idEl.textContent = id;

    header.append(badge, idEl);

    if (target) {
      const targetEl = document.createElement("span");
      targetEl.className = "target";
      targetEl.textContent = `→ ${target}`;
      header.append(targetEl);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-handout__body";
    bodyEl.textContent = this.body;

    container.append(header, bodyEl);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
```

---

## Task 8: `SecretWidget.ts`

**Files:**
- Create: `frontend/src/editor/widgets/SecretWidget.ts`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/widgets/SecretWidget.ts`:

```typescript
import { WidgetType } from "@codemirror/view";

export class SecretWidget extends WidgetType {
  constructor(readonly body: string) {
    super();
  }

  eq(other: SecretWidget): boolean {
    return other.body === this.body;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "directive-secret";

    const label = document.createElement("div");
    label.className = "directive-secret__label";
    label.textContent = "▓ SECRET";

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-secret__body";
    bodyEl.textContent = this.body;

    container.append(label, bodyEl);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
```

- [ ] **Step 2: コミット**

```bash
git add frontend/src/editor/widgets/ && git commit -m "feat: M3 add NpcWidget, HandoutWidget, SecretWidget, widgets.css"
```

---

## Task 9: `live-preview.ts` を更新

**Files:**
- Modify: `frontend/src/editor/live-preview.ts`

- [ ] **Step 1: ファイルを全置換**

`frontend/src/editor/live-preview.ts` を以下の内容で置き換える:

```typescript
import {
  ViewPlugin,
  DecorationSet,
  EditorView,
  ViewUpdate,
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { parseDirectiveBlocks } from "./directive-parser";
import { NpcWidget } from "./widgets/NpcWidget";
import { HandoutWidget } from "./widgets/HandoutWidget";
import { SecretWidget } from "./widgets/SecretWidget";

function makeWidget(block: ReturnType<typeof parseDirectiveBlocks>[number], body: string): WidgetType {
  switch (block.type) {
    case "npc": return new NpcWidget(block.params, body);
    case "handout": return new HandoutWidget(block.params, body);
    case "secret": return new SecretWidget(body);
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const cursor = view.state.selection.main.head;
  const blocks = parseDirectiveBlocks(view.state.doc, view.visibleRanges);
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    if (cursor >= block.from && cursor <= block.to) continue;

    const body =
      block.bodyFrom <= block.bodyTo
        ? view.state.doc.sliceString(block.bodyFrom, block.bodyTo)
        : "";

    const widget = makeWidget(block, body);
    builder.add(block.from, block.to, Decoration.replace({ widget, block: true }));
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
      if (u.view.composing) return;
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none
      ),
  }
);
```

- [ ] **Step 2: コミット**

```bash
git add frontend/src/editor/live-preview.ts && git commit -m "feat: M3 update live-preview to render directive widgets"
```

---

## Task 10: `completion.ts` — オートコンプリート

**Files:**
- Create: `frontend/src/editor/completion.ts`

- [ ] **Step 1: ファイルを作成**

`frontend/src/editor/completion.ts`:

```typescript
import {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { listSections } from "../api/bindings";
import { useScenarioStore } from "../stores/scenarioStore";

let sectionTitleCache: string[] = [];
let lastCacheFetchMs = 0;
const CACHE_TTL_MS = 30_000;

async function getSectionTitles(): Promise<string[]> {
  const now = Date.now();
  if (sectionTitleCache.length > 0 && now - lastCacheFetchMs < CACHE_TTL_MS) {
    return sectionTitleCache;
  }
  const scenarioId = useScenarioStore.getState().scenarioId;
  if (!scenarioId) return [];
  const sections = await listSections(scenarioId);
  sectionTitleCache = sections.map((s) => s.title);
  lastCacheFetchMs = now;
  return sectionTitleCache;
}

export async function directiveCompletion(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  // ::: ディレクティブ補完
  if (/^:::\w*$/.test(textBefore)) {
    return {
      from: line.from + 3,
      options: [
        { label: "npc", apply: "npc Name | Role | Age\n\n:::" },
        { label: "handout", apply: "handout HO1 | PlayerA\n\n:::" },
        { label: "secret", apply: "secret\n\n:::" },
      ],
    };
  }

  // [[WikiLink]] 補完
  const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
  if (wikiMatch) {
    const query = wikiMatch[1];
    const titles = await getSectionTitles();
    return {
      from: context.pos - query.length,
      options: titles.map((t) => ({ label: t, apply: t + "]]" })),
      validFor: /^[^\]]*$/,
    };
  }

  // @NPC 補完
  const npcMatch = textBefore.match(/@([^\s@]*)$/);
  if (npcMatch) {
    const query = npcMatch[1];
    const docText = context.state.doc.toString();
    const npcNames = [
      ...docText.matchAll(/^:::npc\s+([^|\n]+)/gm),
    ]
      .map((m) => m[1].trim())
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return {
      from: context.pos - query.length - 1,
      options: npcNames.map((n) => ({ label: n, apply: "@" + n })),
    };
  }

  // #tag 補完（Markdown 見出しは除外）
  const tagMatch = textBefore.match(/#([^\s#]*)$/);
  if (tagMatch) {
    const beforeHash = textBefore.slice(0, textBefore.lastIndexOf("#"));
    if (/^\s*$/.test(beforeHash)) return null; // 行頭 → Markdown 見出し
    const query = tagMatch[1];
    const docText = context.state.doc.toString();
    const tags = [...docText.matchAll(/#([^\s#]+)/g)]
      .map((m) => m[1])
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return {
      from: context.pos - query.length - 1,
      options: tags.map((t) => ({ label: t, apply: "#" + t })),
    };
  }

  return null;
}
```

---

## Task 11: `setup.ts` を更新

**Files:**
- Modify: `frontend/src/editor/setup.ts`

- [ ] **Step 1: ファイルを全置換**

`frontend/src/editor/setup.ts` を以下の内容で置き換える:

```typescript
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  lineNumbers,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { autosave } from "./autosave";
import { livePreview } from "./live-preview";
import { directiveCompletion } from "./completion";
import "./widgets/widgets.css";

export function createEditorState(doc: string, sectionId: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      EditorView.lineWrapping,
      lineNumbers(),
      history({ minDepth: 50, newGroupDelay: 300 }),
      drawSelection(),
      highlightActiveLine(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle),
      autocompletion({ override: [directiveCompletion] }),
      livePreview,
      autosave(sectionId),
    ],
  });
}

export function createEditorView(
  parent: HTMLElement,
  doc: string,
  sectionId: string
): EditorView {
  return new EditorView({
    state: createEditorState(doc, sectionId),
    parent,
  });
}
```

- [ ] **Step 2: コミット**

```bash
git add frontend/src/editor/completion.ts frontend/src/editor/setup.ts && git commit -m "feat: M3 add directive completion and wire into setup"
```

---

## Task 12: 動作確認

**Files:** なし（手動確認）

- [ ] **Step 1: 開発サーバーを起動**

```bash
wails dev
```

- [ ] **Step 2: :::npc ライブプレビューを確認**

エディタに以下を入力し、カーソルをブロック外に移動する:

```
:::npc 田中次郎 | 探偵 | 35
鋭い眼光を持つ中年の探偵。
:::
```

Expected: NPC テーブルウィジェット（紫系）が表示される。カーソルをブロック内に移動すると生テキストに戻る。

- [ ] **Step 3: :::handout ライブプレビューを確認**

```
:::handout HO1 | PlayerA
古い手紙の切れ端。
:::
```

Expected: Handout 青点線カードが表示される。

- [ ] **Step 4: :::secret ライブプレビューを確認**

```
:::secret
GM のみが知る真相。
:::
```

Expected: Secret グレーアウトブロックが表示される。

- [ ] **Step 5: オートコンプリートを確認**

- `:::` を入力 → `npc` / `handout` / `secret` の候補が出る
- `[[` を入力 → セクションタイトルの候補が出る
- `@` を入力 → 上記で入力した NPC 名の候補が出る
- `#` を文中で入力 → タグ候補が出る（行頭では出ない）

- [ ] **Step 6: IME を確認**

日本語入力で変換中に NPC ブロック内/外を行き来してもウィジェットが壊れないことを確認。

- [ ] **Step 7: 最終コミット**

```bash
git add -A && git commit -m "chore: M3 manual verification complete"
```

---

## Task 13: PR 作成

- [ ] **Step 1: PR を作成**

```bash
git push -u origin feature/m3-custom-syntax
gh pr create \
  --title "feat: M3 独自記法 + ライブプレビュー + 補完" \
  --body "## Summary
- \`:::npc\` / \`:::handout\` / \`:::secret\` ブロックを WidgetDecoration でライブプレビュー表示
- カーソルがブロック内にある間は生テキストに戻り編集可能
- \`[[WikiLink]]\` / \`@NPC\` / \`#tag\` / \`:::\` のオートコンプリートを追加
- regex ベース ViewPlugin（lezer 拡張なし）で visibleRanges のみスキャン
- \`directive-parser.ts\` を純粋関数として抽出し vitest テスト6件追加

## Test plan
- [ ] \`npm test\` が 6 件 PASS
- [ ] \`:::npc\` ウィジェットが表示される
- [ ] \`:::handout\` ウィジェットが表示される
- [ ] \`:::secret\` ウィジェットが表示される
- [ ] カーソル入りで生テキストに戻る
- [ ] 4 種のオートコンプリートが動作する
- [ ] IME 変換中にウィジェットが壊れない

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

