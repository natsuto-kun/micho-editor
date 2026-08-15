# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TRPG scenario editor — a local desktop app for writing/managing tabletop RPG scenarios (10–200k Japanese characters per scenario). Built with **Wails v2 (Go) + React + TypeScript + CodeMirror 6 + SQLite**.

The codebase is currently in design phase. See `docs/overall-design.md` for the full architecture document.

## Build & Dev Commands

Once the project is initialized (Wails scaffolding run), typical commands will be:

```bash
wails dev          # start dev server with hot-reload
wails build        # production build
go test ./...      # run all Go tests
npm --prefix frontend test   # run frontend tests
npm ls @codemirror/state     # check for duplicate CM6 installs (run periodically)
```

## Architecture

### Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Wails v2 — Go backend, OS WebView (no Chromium bundled) |
| Frontend | React + TypeScript |
| Editor core | CodeMirror 6 — viewport virtualization handles 200k chars |
| Markdown parse | @lezer/markdown with custom `MarkdownConfig` extensions |
| State management | Zustand — metadata only, never body text |
| Persistence | SQLite via `modernc.org/sqlite` (CGO-free, FTS5 available) |
| Full-text search | FTS5 with `tokenize='trigram'` for Japanese substring match |
| Export | goldmark (Go) with the same directive extensions as the frontend parser |

### Data Flow

Frontend (WebView) ↔ Wails JSON bindings ↔ Go API (`app.go`) ↔ SQLite (`.trpg` file)

Media files are served via Wails `AssetServer` at `/media/{id}` — never base64-embedded.

### Directory Layout (planned)

```
trpg-editor/
├── main.go                    # Wails entry point
├── app.go                     # public API bound to frontend
├── internal/
│   ├── store/                 # SQLite access (db.go, scenario.go, section.go)
│   │   └── migrations/        # 0001_init.sql, 0002_fts.sql
│   ├── search/fts.go          # FTS5 query helpers
│   ├── media/                 # import.go, handler.go (AssetServer)
│   ├── render/                # goldmark extensions + HTML/PDF export
│   └── history/snapshot.go
└── frontend/src/
    ├── editor/
    │   ├── setup.ts           # CM6 extension assembly
    │   ├── markdown-ext.ts    # @lezer/markdown directive parser
    │   ├── live-preview.ts    # decoration ViewPlugin
    │   ├── widgets/           # NpcWidget, ImageWidget
    │   ├── completion.ts      # [[WikiLink]] / #tag autocomplete
    │   └── autosave.ts
    ├── components/            # Outline.tsx, SearchPanel.tsx, SessionView.tsx
    ├── stores/                # scenarioStore.ts (meta only), uiStore.ts
    └── api/bindings.ts        # typed wrappers around Wails-generated bindings
```

### Critical Design Rules

**Body text never enters React state or Zustand.** It lives exclusively in CM6 `EditorState`. Stores hold only section ID, title, kind, dirty flag, and rev. Violating this causes sidebar re-renders on every keystroke.

**`ListSections` must not return body text.** Returning 200k chars over IPC on startup is unacceptable. Body is fetched individually via `GetSection` when a section is opened.

**CM6 `syntaxTree().iterate()` must be limited to `view.visibleRanges`.** Iterating the full document in a `ViewPlugin` makes performance scale with document length.

**Skip all decoration rebuilds and saves while `view.composing` is true.** Japanese IME composition breaks if widgets are replaced mid-conversion. This must be verified on real hardware (macOS + Windows) in M0.5 before investing further in the editor stack.

### Save Strategy

Autosave debounces 800ms idle, with a hard 5-second forced flush. On section switch, window blur, and `BeforeClose` (Wails hook), flush synchronously before proceeding. `SaveSection` uses optimistic locking on `rev` — a `RowsAffected == 0` result means a conflict.

### Custom Markdown Directives

TRPG-specific block syntax parsed by both @lezer/markdown (frontend) and goldmark (Go export):

```
:::npc Name | Role | Age
...body...
:::

:::handout HO1 | PlayerA
...
:::

:::secret
GM-only content (stripped from PL-distribution export)
:::
```

Wiki links use `[[Section Title]]` syntax. The directive spec is the shared contract between the two parsers — keep them in sync.

### Export Modes

| Mode | `:::secret` blocks | GM notes |
|---|---|---|
| GM version | included | included |
| PL-distribution | **stripped** | stripped |
| Handouts only | stripped | stripped |

Secret stripping must be covered by Go unit tests. A missed `:::secret` block in a PL export is a content accident.

### FTS5 Search Notes

`tokenize='trigram'` indexes every 3-char window — no MeCab needed for Japanese substring match. Trade-offs: index is 2–3× body size; queries under 3 characters must fall back to `LIKE`. Frontend should route: ≥3 chars → FTS5, <3 chars → title `LIKE`.

### Performance Targets

| Operation | Target |
|---|---|
| Startup to editable | < 1.0s (500 sections, 200k chars) |
| Keystroke latency | < 16ms |
| Section switch | < 100ms |
| Full-text search | < 50ms |
| Single save (WAL) | < 30ms |
| Memory footprint | < 300MB |
