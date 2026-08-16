# M1 編集基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セクション CRUD・アウトライン UI・リアルオートセーブを実装し、20万字ダミーデータで入力レイテンシ 16ms 以下を確認する。

**Architecture:** Go ストア層（scenario/section CRUD + 楽観ロック + fractional indexing）→ Wails バインディング更新 → Zustand メタストア → Outline UI + 実 SaveSection 呼び出し autosave。本文テキストは CM6 EditorState にのみ置き Zustand に入れない。

**Tech Stack:** Go 1.26 / Wails v2.14.0 / modernc.org/sqlite / React + TypeScript / Zustand / CodeMirror 6

---

## ファイル構成

**新規作成:**
- `internal/store/sortkey.go` — fractional indexing ヘルパー (KeyBetween)
- `internal/store/scenario.go` — Scenario 型 + CRUD
- `internal/store/section.go` — SectionMeta/Section/SaveResult 型 + CRUD
- `internal/store/store_test.go` — ストア統合テスト
- `frontend/src/stores/scenarioStore.ts` — セクションメタ・dirty・rev のみ管理
- `frontend/src/stores/uiStore.ts` — activeSectionId 管理
- `frontend/src/api/bindings.ts` — Wails バインディング型付きラッパー
- `frontend/src/components/Outline.tsx` — セクションツリー表示
- `cmd/seed/main.go` — 500 セクション / 20 万字ダミーデータ生成

**変更:**
- `app.go` — 8 つの公開 API + AckFlush + beforeClose
- `main.go` — OnBeforeClose フック追加
- `frontend/wailsjs/go/models.ts` — 新型を追加（Wails 自動生成に合わせて手動更新）
- `frontend/wailsjs/go/main/App.d.ts` — 型定義追加
- `frontend/wailsjs/go/main/App.js` — JS バインディング追加
- `frontend/src/editor/autosave.ts` — console.log → 実 SaveSection 呼び出し
- `frontend/src/App.tsx` — アウトライン統合・セクション切り替え・blur/beforeClose フラッシュ

---

## Task 1: `internal/store/sortkey.go` — fractional indexing ヘルパー

**Files:**
- Create: `internal/store/sortkey.go`

- [ ] **Step 1: sortkey.go を作成**

`internal/store/sortkey.go`:

```go
package store

import (
	"fmt"
	"strings"
)

// sortAlphabet is [0-9A-Za-z], same ordering as ASCII — keys sort lexicographically.
const sortAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const sortBase = 62
const sortMidIdx = 31 // 'V'

// KeyBetween returns a sort key strictly between lo and hi.
// lo="" means -∞, hi="" means +∞.
// Special case: KeyBetween("","") returns "a0".
func KeyBetween(lo, hi string) (string, error) {
	if lo != "" && hi != "" && lo >= hi {
		return "", fmt.Errorf("KeyBetween: lo %q >= hi %q", lo, hi)
	}
	if lo == "" && hi == "" {
		return "a0", nil
	}
	return lexBetween(lo, hi)
}

func lexBetween(lo, hi string) (string, error) {
	result := make([]byte, 0, max2(len(lo), len(hi))+2)
	maxLen := max2(len(lo), len(hi))

	for i := 0; i <= maxLen; i++ {
		a := digitAt(lo, i)
		b := hiDigitAt(hi, i)

		mid := (a + b) / 2
		result = append(result, sortAlphabet[mid])

		if mid > a {
			if (a+b)%2 == 1 {
				result = append(result, sortAlphabet[sortMidIdx])
			}
			return string(result), nil
		}

		// mid == a; if mid < b, hi is exhausted for remaining positions
		if mid < b {
			for j := i + 1; ; j++ {
				aj := digitAt(lo, j)
				midj := (aj + sortBase) / 2
				result = append(result, sortAlphabet[midj])
				if midj > aj {
					if (aj+sortBase)%2 == 1 {
						result = append(result, sortAlphabet[sortMidIdx])
					}
					return string(result), nil
				}
			}
		}
		// mid == a == b: same digit in both, continue
	}
	return "", fmt.Errorf("KeyBetween: no midpoint between %q and %q", lo, hi)
}

// digitAt returns the alphabet index of key[i], or 0 if i >= len(key).
func digitAt(key string, i int) int {
	if i >= len(key) {
		return 0
	}
	idx := strings.IndexByte(sortAlphabet, key[i])
	if idx < 0 {
		return 0
	}
	return idx
}

// hiDigitAt returns the alphabet index of key[i], or sortBase if i >= len(key) or key is empty.
func hiDigitAt(key string, i int) int {
	if key == "" || i >= len(key) {
		return sortBase
	}
	idx := strings.IndexByte(sortAlphabet, key[i])
	if idx < 0 {
		return sortBase
	}
	return idx
}

func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./internal/store/...
```

期待値: エラーなし

- [ ] **Step 3: KeyBetween の動作確認（インラインテスト）**

`internal/store/store_test.go` を新規作成:

```go
package store_test

import (
	"testing"

	"trpg-editor/internal/store"
)

func TestKeyBetween(t *testing.T) {
	cases := []struct {
		lo, hi, wantGT, wantLT string
	}{
		{"", "", "", ""},          // special case: returns "a0"
		{"a0", "a1", "a0", "a1"}, // "a0V"
		{"a0V", "a1", "a0V", "a1"},
		{"a0", "", "a0", ""},
		{"", "a0", "", "a0"},
	}

	for _, c := range cases {
		got, err := store.KeyBetween(c.lo, c.hi)
		if err != nil {
			t.Errorf("KeyBetween(%q,%q) error: %v", c.lo, c.hi, err)
			continue
		}
		if c.lo == "" && c.hi == "" {
			if got != "a0" {
				t.Errorf("KeyBetween(\"\",\"\") = %q, want \"a0\"", got)
			}
			continue
		}
		if c.lo != "" && got <= c.lo {
			t.Errorf("KeyBetween(%q,%q) = %q, want > %q", c.lo, c.hi, got, c.lo)
		}
		if c.hi != "" && got >= c.hi {
			t.Errorf("KeyBetween(%q,%q) = %q, want < %q", c.lo, c.hi, got, c.hi)
		}
	}
}
```

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go test ./internal/store/... -run TestKeyBetween -v
```

期待値: `PASS`

---

## Task 2: `internal/store/scenario.go` — Scenario CRUD

**Files:**
- Create: `internal/store/scenario.go`

- [ ] **Step 1: scenario.go を作成**

`internal/store/scenario.go`:

```go
package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Scenario is the top-level container for sections.
type Scenario struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	System    string `json:"system"`
	Players   string `json:"players"`
	PlayTime  string `json:"playTime"`
	Meta      string `json:"meta"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// ScenarioMeta holds updatable fields.
type ScenarioMeta struct {
	System   string `json:"system"`
	Players  string `json:"players"`
	PlayTime string `json:"playTime"`
	Meta     string `json:"meta"`
}

// GetOrCreateDefaultScenario returns the oldest existing scenario or creates one.
func (s *Store) GetOrCreateDefaultScenario() (Scenario, error) {
	var sc Scenario
	err := s.db.QueryRow(`
		SELECT id, title,
		       COALESCE(system,''), COALESCE(players,''), COALESCE(play_time,''),
		       meta, created_at, updated_at
		FROM scenarios
		ORDER BY created_at ASC
		LIMIT 1
	`).Scan(&sc.ID, &sc.Title, &sc.System, &sc.Players, &sc.PlayTime,
		&sc.Meta, &sc.CreatedAt, &sc.UpdatedAt)

	if err == sql.ErrNoRows {
		return s.createScenario("新規シナリオ", "")
	}
	if err != nil {
		return Scenario{}, fmt.Errorf("get default scenario: %w", err)
	}
	return sc, nil
}

func (s *Store) createScenario(title, system string) (Scenario, error) {
	id := uuid.New().String()
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`INSERT INTO scenarios(id, title, system, players, play_time, meta, created_at, updated_at)
		 VALUES (?, ?, ?, '', '', '{}', ?, ?)`,
		id, title, system, now, now,
	)
	if err != nil {
		return Scenario{}, fmt.Errorf("create scenario: %w", err)
	}
	return Scenario{
		ID: id, Title: title, System: system,
		Meta: "{}", CreatedAt: now, UpdatedAt: now,
	}, nil
}

// UpdateScenarioMeta updates editable metadata fields.
func (s *Store) UpdateScenarioMeta(id string, meta ScenarioMeta) error {
	_, err := s.db.Exec(
		`UPDATE scenarios SET system=?, players=?, play_time=?, meta=?, updated_at=? WHERE id=?`,
		meta.System, meta.Players, meta.PlayTime, meta.Meta, time.Now().UnixMilli(), id,
	)
	return err
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./internal/store/...
```

期待値: エラーなし

---

## Task 3: `internal/store/section.go` — Section CRUD + 楽観ロック

**Files:**
- Create: `internal/store/section.go`

- [ ] **Step 1: section.go を作成**

`internal/store/section.go`:

```go
package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// SectionMeta contains section fields excluding body text.
// Body is fetched separately via GetSection to avoid IPC overhead on ListSections.
type SectionMeta struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenarioId"`
	ParentID   string `json:"parentId"` // "" means top-level (NULL in DB)
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	SortKey    string `json:"sortKey"`
	Rev        int    `json:"rev"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// Section includes the body text, returned only by GetSection.
type Section struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenarioId"`
	ParentID   string `json:"parentId"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Body       string `json:"body"`
	SortKey    string `json:"sortKey"`
	Rev        int    `json:"rev"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// SaveResult is returned by SaveSection.
type SaveResult struct {
	Rev      int  `json:"rev"`
	Conflict bool `json:"conflict"`
}

// ListSections returns section metadata (no body) ordered by sort_key.
func (s *Store) ListSections(scenarioID string) ([]SectionMeta, error) {
	rows, err := s.db.Query(`
		SELECT id, scenario_id, COALESCE(parent_id,''), kind, title, sort_key, rev, updated_at
		FROM sections
		WHERE scenario_id = ?
		ORDER BY sort_key
	`, scenarioID)
	if err != nil {
		return nil, fmt.Errorf("list sections: %w", err)
	}
	defer rows.Close()

	var metas []SectionMeta
	for rows.Next() {
		var m SectionMeta
		if err := rows.Scan(&m.ID, &m.ScenarioID, &m.ParentID, &m.Kind,
			&m.Title, &m.SortKey, &m.Rev, &m.UpdatedAt); err != nil {
			return nil, err
		}
		metas = append(metas, m)
	}
	return metas, rows.Err()
}

// GetSection returns a section including its body text.
func (s *Store) GetSection(id string) (Section, error) {
	var sec Section
	err := s.db.QueryRow(`
		SELECT id, scenario_id, COALESCE(parent_id,''), kind, title, body, sort_key, rev, updated_at
		FROM sections WHERE id = ?
	`, id).Scan(&sec.ID, &sec.ScenarioID, &sec.ParentID, &sec.Kind,
		&sec.Title, &sec.Body, &sec.SortKey, &sec.Rev, &sec.UpdatedAt)
	if err != nil {
		return Section{}, fmt.Errorf("get section %s: %w", id, err)
	}
	return sec, nil
}

// SaveSection updates body text using optimistic locking on rev.
// Returns Conflict:true if the row was modified by another writer.
func (s *Store) SaveSection(id, body string, rev int) (SaveResult, error) {
	res, err := s.db.Exec(`
		UPDATE sections
		SET body = ?, rev = rev + 1, updated_at = ?
		WHERE id = ? AND rev = ?
	`, body, time.Now().UnixMilli(), id, rev)
	if err != nil {
		return SaveResult{}, fmt.Errorf("save section %s: %w", id, err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return SaveResult{Conflict: true}, nil
	}
	return SaveResult{Rev: rev + 1}, nil
}

// CreateSection inserts a new section after afterID (or at the beginning if afterID="").
func (s *Store) CreateSection(scenarioID, parentID, kind, title, afterID string) (SectionMeta, error) {
	newKey, err := s.findSortKey(scenarioID, parentID, afterID)
	if err != nil {
		return SectionMeta{}, fmt.Errorf("find sort key: %w", err)
	}

	id := uuid.New().String()
	now := time.Now().UnixMilli()
	_, err = s.db.Exec(`
		INSERT INTO sections(id, scenario_id, parent_id, kind, title, body, sort_key, rev, updated_at)
		VALUES (?, ?, NULLIF(?,?), ?, ?, '', ?, 1, ?)
	`, id, scenarioID, parentID, "", kind, title, newKey, now)
	if err != nil {
		return SectionMeta{}, fmt.Errorf("insert section: %w", err)
	}
	return SectionMeta{
		ID: id, ScenarioID: scenarioID, ParentID: parentID,
		Kind: kind, Title: title, SortKey: newKey, Rev: 1, UpdatedAt: now,
	}, nil
}

// MoveSection changes a section's parent and position.
func (s *Store) MoveSection(id, newParentID, afterID string) error {
	var scenarioID string
	if err := s.db.QueryRow(`SELECT scenario_id FROM sections WHERE id = ?`, id).
		Scan(&scenarioID); err != nil {
		return fmt.Errorf("find section: %w", err)
	}

	newKey, err := s.findSortKey(scenarioID, newParentID, afterID)
	if err != nil {
		return fmt.Errorf("find sort key: %w", err)
	}

	_, err = s.db.Exec(`
		UPDATE sections SET parent_id = NULLIF(?,?), sort_key = ?, updated_at = ? WHERE id = ?
	`, newParentID, "", newKey, time.Now().UnixMilli(), id)
	return err
}

// DeleteSection removes a section and cascades to children, snapshots, and links.
func (s *Store) DeleteSection(id string) error {
	_, err := s.db.Exec(`DELETE FROM sections WHERE id = ?`, id)
	return err
}

// findSortKey returns a sort_key to insert after afterID (or at beginning if afterID="").
func (s *Store) findSortKey(scenarioID, parentID, afterID string) (string, error) {
	var loKey string

	if afterID != "" {
		if err := s.db.QueryRow(`SELECT sort_key FROM sections WHERE id = ?`, afterID).
			Scan(&loKey); err != nil {
			return "", fmt.Errorf("find afterID: %w", err)
		}
	}

	var hiKey sql.NullString
	err := s.db.QueryRow(`
		SELECT sort_key FROM sections
		WHERE scenario_id = ? AND COALESCE(parent_id,'') = ? AND sort_key > ?
		ORDER BY sort_key ASC LIMIT 1
	`, scenarioID, parentID, loKey).Scan(&hiKey)
	if err != nil && err != sql.ErrNoRows {
		return "", fmt.Errorf("find next section: %w", err)
	}

	hi := ""
	if hiKey.Valid {
		hi = hiKey.String
	}
	return KeyBetween(loKey, hi)
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./internal/store/...
```

期待値: エラーなし

---

## Task 4: `internal/store/store_test.go` — 統合テスト

**Files:**
- Modify: `internal/store/store_test.go` (Task 1 で KeyBetween テストを追加済み。セクション CRUD を追記)

- [ ] **Step 1: store_test.go にストア統合テストを追記**

`internal/store/store_test.go` を以下の内容に **完全置換**:

```go
package store_test

import (
	"os"
	"testing"

	"trpg-editor/internal/store"
)

// ---- KeyBetween unit tests ----

func TestKeyBetween(t *testing.T) {
	cases := []struct {
		lo, hi string
		wantEq string // non-empty only for the special ("","") case
	}{
		{lo: "", hi: "", wantEq: "a0"},
		{lo: "a0", hi: "a1"},
		{lo: "a0V", hi: "a1"},
		{lo: "a0", hi: ""},
		{lo: "", hi: "a0"},
		{lo: "n", hi: ""},
		{lo: "a0", hi: "a0V"},
	}

	for _, c := range cases {
		got, err := store.KeyBetween(c.lo, c.hi)
		if err != nil {
			t.Errorf("KeyBetween(%q,%q) error: %v", c.lo, c.hi, err)
			continue
		}
		if c.wantEq != "" {
			if got != c.wantEq {
				t.Errorf("KeyBetween(%q,%q) = %q, want %q", c.lo, c.hi, got, c.wantEq)
			}
			continue
		}
		if c.lo != "" && got <= c.lo {
			t.Errorf("KeyBetween(%q,%q) = %q: not > lo", c.lo, c.hi, got)
		}
		if c.hi != "" && got >= c.hi {
			t.Errorf("KeyBetween(%q,%q) = %q: not < hi", c.lo, c.hi, got)
		}
	}
}

// ---- Store integration tests ----

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	f, err := os.CreateTemp("", "test-*.trpg")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	t.Cleanup(func() { os.Remove(path) })

	s, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestGetOrCreateDefaultScenario(t *testing.T) {
	s := openTestStore(t)

	sc, err := s.GetOrCreateDefaultScenario()
	if err != nil {
		t.Fatal(err)
	}
	if sc.ID == "" {
		t.Error("expected non-empty ID")
	}
	if sc.Title == "" {
		t.Error("expected non-empty Title")
	}

	// Second call must return the same scenario, not create a new one.
	sc2, err := s.GetOrCreateDefaultScenario()
	if err != nil {
		t.Fatal(err)
	}
	if sc2.ID != sc.ID {
		t.Errorf("second call returned different ID: %s vs %s", sc2.ID, sc.ID)
	}
}

func TestSectionCRUD(t *testing.T) {
	s := openTestStore(t)

	sc, err := s.GetOrCreateDefaultScenario()
	if err != nil {
		t.Fatal(err)
	}

	// Create first section.
	m1, err := s.CreateSection(sc.ID, "", "scene", "Scene 1", "")
	if err != nil {
		t.Fatal(err)
	}
	if m1.ID == "" || m1.SortKey == "" {
		t.Error("expected non-empty ID and SortKey")
	}

	// Create second section after the first.
	m2, err := s.CreateSection(sc.ID, "", "scene", "Scene 2", m1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m2.SortKey <= m1.SortKey {
		t.Errorf("second section sort key %q must be > first %q", m2.SortKey, m1.SortKey)
	}

	// Create section between m1 and m2.
	m1b, err := s.CreateSection(sc.ID, "", "scene", "Scene 1b", m1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !(m1.SortKey < m1b.SortKey && m1b.SortKey < m2.SortKey) {
		t.Errorf("interleaved section sort key %q not between %q and %q", m1b.SortKey, m1.SortKey, m2.SortKey)
	}

	// ListSections must not include body and must be in sort_key order.
	metas, err := s.ListSections(sc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 3 {
		t.Fatalf("expected 3 sections, got %d", len(metas))
	}
	for i := 1; i < len(metas); i++ {
		if metas[i].SortKey <= metas[i-1].SortKey {
			t.Errorf("sections not in sort_key order at %d", i)
		}
	}

	// GetSection must return body.
	sec, err := s.GetSection(m1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sec.Body != "" {
		t.Errorf("new section body should be empty, got %q", sec.Body)
	}

	// SaveSection with correct rev must succeed.
	res, err := s.SaveSection(m1.ID, "Hello, world!", 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.Conflict {
		t.Error("unexpected conflict on first save")
	}
	if res.Rev != 2 {
		t.Errorf("expected rev=2 after save, got %d", res.Rev)
	}

	// SaveSection with stale rev must return Conflict.
	res2, err := s.SaveSection(m1.ID, "Stale", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !res2.Conflict {
		t.Error("expected conflict on stale rev")
	}

	// DeleteSection must remove the section.
	if err := s.DeleteSection(m2.ID); err != nil {
		t.Fatal(err)
	}
	metas2, err := s.ListSections(sc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(metas2) != 2 {
		t.Fatalf("expected 2 sections after delete, got %d", len(metas2))
	}
}
```

- [ ] **Step 2: テスト実行**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go test ./internal/store/... -v 2>&1 | grep -E "^(=== RUN|--- |PASS|FAIL|ok)"
```

期待値:
```
=== RUN   TestKeyBetween
--- PASS: TestKeyBetween
=== RUN   TestGetOrCreateDefaultScenario
--- PASS: TestGetOrCreateDefaultScenario
=== RUN   TestSectionCRUD
--- PASS: TestSectionCRUD
ok      trpg-editor/internal/store
```

---

## Task 5: `app.go` + `main.go` — 公開 API + BeforeClose

**Files:**
- Modify: `app.go`
- Modify: `main.go`

- [ ] **Step 1: app.go を完全置換**

`app.go`:

```go
package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"trpg-editor/internal/store"
)

type App struct {
	ctx          context.Context
	store        *store.Store
	mu           sync.Mutex
	pendingFlush chan struct{}
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	home, err := os.UserHomeDir()
	if err != nil {
		runtime.LogErrorf(ctx, "Failed to get home dir: %v", err)
		return
	}
	dbPath := filepath.Join(home, ".trpg-editor", "default.trpg")

	s, err := store.Open(dbPath)
	if err != nil {
		runtime.LogErrorf(ctx, "Failed to open store: %v", err)
		return
	}
	a.store = s
}

func (a *App) shutdown(ctx context.Context) {
	if a.store != nil {
		a.store.Close()
	}
}

// beforeClose emits "beforeClose" to the frontend and waits up to 2s for AckFlush.
func (a *App) beforeClose(ctx context.Context) bool {
	ch := make(chan struct{}, 1)
	a.mu.Lock()
	a.pendingFlush = ch
	a.mu.Unlock()

	runtime.EventsEmit(ctx, "beforeClose")

	select {
	case <-ch:
	case <-time.After(2 * time.Second):
	}
	return false // allow close
}

// AckFlush is called by the frontend after flushing pending saves on beforeClose.
func (a *App) AckFlush() {
	a.mu.Lock()
	ch := a.pendingFlush
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// --- Scenario ---

// OpenScenario returns the default scenario, creating one if the DB is empty.
func (a *App) OpenScenario() (store.Scenario, error) {
	return a.store.GetOrCreateDefaultScenario()
}

// --- Sections ---

// ListSections returns section metadata (without body) ordered by sort_key.
func (a *App) ListSections(scenarioID string) ([]store.SectionMeta, error) {
	return a.store.ListSections(scenarioID)
}

// GetSection returns a section including its body text.
func (a *App) GetSection(id string) (store.Section, error) {
	return a.store.GetSection(id)
}

// SaveSection saves body text with optimistic locking.
// Returns Conflict:true if rev does not match the stored rev.
func (a *App) SaveSection(id, body string, rev int) (store.SaveResult, error) {
	return a.store.SaveSection(id, body, rev)
}

// CreateSection inserts a new section after afterID (empty = insert at beginning).
func (a *App) CreateSection(scenarioID, parentID, kind, title, afterID string) (store.SectionMeta, error) {
	return a.store.CreateSection(scenarioID, parentID, kind, title, afterID)
}

// MoveSection moves a section to a new parent/position.
func (a *App) MoveSection(id, newParentID, afterID string) error {
	return a.store.MoveSection(id, newParentID, afterID)
}

// DeleteSection removes a section and its children.
func (a *App) DeleteSection(id string) error {
	return a.store.DeleteSection(id)
}
```

- [ ] **Step 2: main.go を更新 (OnBeforeClose 追加)**

`main.go` の `wails.Run` の options に `OnBeforeClose: app.beforeClose,` を追加:

```go
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "TRPG シナリオエディタ",
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
```

- [ ] **Step 3: ビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./...
```

期待値: エラーなし

---

## Task 6: Wails バインディング手動更新

Wails は `wails dev` / `wails build` 時に `frontend/wailsjs/` を自動生成する。
ここでは Go 型から生成される内容を手動で反映し、フロントエンド実装が型チェックを通るようにする。

**Files:**
- Modify: `frontend/wailsjs/go/models.ts`
- Modify: `frontend/wailsjs/go/main/App.d.ts`
- Modify: `frontend/wailsjs/go/main/App.js`

- [ ] **Step 1: models.ts を更新**

`frontend/wailsjs/go/models.ts`:

```typescript
// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT

export namespace store {

	export class SaveResult {
		conflict: boolean;
		rev: number;
		static createFrom(source: any = {}): SaveResult {
			return new SaveResult(source);
		}
		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
			this.conflict = source["conflict"];
			this.rev = source["rev"];
		}
	}

	export class Scenario {
		id: string;
		title: string;
		system: string;
		players: string;
		playTime: string;
		meta: string;
		createdAt: number;
		updatedAt: number;
		static createFrom(source: any = {}): Scenario {
			return new Scenario(source);
		}
		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
			this.id = source["id"];
			this.title = source["title"];
			this.system = source["system"];
			this.players = source["players"];
			this.playTime = source["playTime"];
			this.meta = source["meta"];
			this.createdAt = source["createdAt"];
			this.updatedAt = source["updatedAt"];
		}
	}

	export class SectionMeta {
		id: string;
		scenarioId: string;
		parentId: string;
		kind: string;
		title: string;
		sortKey: string;
		rev: number;
		updatedAt: number;
		static createFrom(source: any = {}): SectionMeta {
			return new SectionMeta(source);
		}
		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
			this.id = source["id"];
			this.scenarioId = source["scenarioId"];
			this.parentId = source["parentId"];
			this.kind = source["kind"];
			this.title = source["title"];
			this.sortKey = source["sortKey"];
			this.rev = source["rev"];
			this.updatedAt = source["updatedAt"];
		}
	}

	export class Section {
		id: string;
		scenarioId: string;
		parentId: string;
		kind: string;
		title: string;
		body: string;
		sortKey: string;
		rev: number;
		updatedAt: number;
		static createFrom(source: any = {}): Section {
			return new Section(source);
		}
		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
			this.id = source["id"];
			this.scenarioId = source["scenarioId"];
			this.parentId = source["parentId"];
			this.kind = source["kind"];
			this.title = source["title"];
			this.body = source["body"];
			this.sortKey = source["sortKey"];
			this.rev = source["rev"];
			this.updatedAt = source["updatedAt"];
		}
	}

	export class Store {
		static createFrom(source: any = {}): Store {
			return new Store(source);
		}
		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
		}
	}

}
```

- [ ] **Step 2: App.d.ts を更新**

`frontend/wailsjs/go/main/App.d.ts`:

```typescript
// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {store} from '../models';

export function AckFlush():Promise<void>;
export function CreateSection(scenarioID:string,parentID:string,kind:string,title:string,afterID:string):Promise<store.SectionMeta>;
export function DeleteSection(id:string):Promise<void>;
export function GetSection(id:string):Promise<store.Section>;
export function ListSections(scenarioID:string):Promise<Array<store.SectionMeta>>;
export function MoveSection(id:string,newParentID:string,afterID:string):Promise<void>;
export function OpenScenario():Promise<store.Scenario>;
export function SaveSection(id:string,body:string,rev:number):Promise<store.SaveResult>;
export function Store():Promise<store.Store>;
```

- [ ] **Step 3: App.js を更新**

`frontend/wailsjs/go/main/App.js`:

```javascript
// @ts-check
// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT

export function AckFlush() {
  return window['go']['main']['App']['AckFlush']();
}

export function CreateSection(scenarioID, parentID, kind, title, afterID) {
  return window['go']['main']['App']['CreateSection'](scenarioID, parentID, kind, title, afterID);
}

export function DeleteSection(id) {
  return window['go']['main']['App']['DeleteSection'](id);
}

export function GetSection(id) {
  return window['go']['main']['App']['GetSection'](id);
}

export function ListSections(scenarioID) {
  return window['go']['main']['App']['ListSections'](scenarioID);
}

export function MoveSection(id, newParentID, afterID) {
  return window['go']['main']['App']['MoveSection'](id, newParentID, afterID);
}

export function OpenScenario() {
  return window['go']['main']['App']['OpenScenario']();
}

export function SaveSection(id, body, rev) {
  return window['go']['main']['App']['SaveSection'](id, body, rev);
}

export function Store() {
  return window['go']['main']['App']['Store']();
}
```

- [ ] **Step 4: TypeScript 型チェック（フロントエンドのみ）**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし（この時点ではまだ stores/api が存在しないため、既存ファイルのみチェック）

---

## Task 7: Zustand ストア — `scenarioStore.ts` + `uiStore.ts`

**Files:**
- Create: `frontend/src/stores/scenarioStore.ts`
- Create: `frontend/src/stores/uiStore.ts`

- [ ] **Step 1: ディレクトリ作成確認**

```bash
ls /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/
```

`stores/` が存在しない場合: `mkdir -p /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/stores`

- [ ] **Step 2: scenarioStore.ts を作成**

`frontend/src/stores/scenarioStore.ts`:

```typescript
import { create } from "zustand";

export interface SectionEntry {
  id: string;
  scenarioId: string;
  parentId: string;
  kind: string;
  title: string;
  sortKey: string;
  rev: number;
  updatedAt: number;
  dirty: boolean;
  saveError?: string;
}

interface ScenarioStore {
  scenarioId: string;
  scenarioTitle: string;
  sections: SectionEntry[];

  setScenario: (id: string, title: string) => void;
  setSections: (metas: Array<Omit<SectionEntry, "dirty" | "saveError">>) => void;
  upsertSection: (meta: Omit<SectionEntry, "dirty" | "saveError">) => void;
  removeSection: (id: string) => void;
  markDirty: (id: string) => void;
  markSaved: (id: string, rev: number) => void;
  markSaveError: (id: string, error: string) => void;
  revOf: (id: string) => number;
  isDirty: (id: string) => boolean;
}

export const useScenarioStore = create<ScenarioStore>((set, get) => ({
  scenarioId: "",
  scenarioTitle: "",
  sections: [],

  setScenario: (id, title) => set({ scenarioId: id, scenarioTitle: title }),

  setSections: (metas) =>
    set({ sections: metas.map((m) => ({ ...m, dirty: false })) }),

  upsertSection: (meta) =>
    set((state) => {
      const idx = state.sections.findIndex((s) => s.id === meta.id);
      const entry: SectionEntry = { ...meta, dirty: false };
      if (idx >= 0) {
        const next = [...state.sections];
        next[idx] = { ...next[idx], ...entry };
        return { sections: next };
      }
      return { sections: [...state.sections, entry] };
    }),

  removeSection: (id) =>
    set((state) => ({ sections: state.sections.filter((s) => s.id !== id) })),

  markDirty: (id) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, dirty: true } : s
      ),
    })),

  markSaved: (id, rev) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, rev, dirty: false, saveError: undefined } : s
      ),
    })),

  markSaveError: (id, error) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, saveError: error } : s
      ),
    })),

  revOf: (id) => get().sections.find((s) => s.id === id)?.rev ?? 1,

  isDirty: (id) => get().sections.find((s) => s.id === id)?.dirty ?? false,
}));
```

- [ ] **Step 3: uiStore.ts を作成**

`frontend/src/stores/uiStore.ts`:

```typescript
import { create } from "zustand";

interface UIStore {
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
```

- [ ] **Step 4: TypeScript 型チェック**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし

---

## Task 8: `frontend/src/api/bindings.ts` — 型付きラッパー

**Files:**
- Create: `frontend/src/api/bindings.ts`

- [ ] **Step 1: api ディレクトリ確認**

```bash
ls /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/
```

`api/` が存在しない場合: `mkdir -p /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/api`

- [ ] **Step 2: bindings.ts を作成**

`frontend/src/api/bindings.ts`:

```typescript
import {
  AckFlush as _AckFlush,
  CreateSection as _CreateSection,
  DeleteSection as _DeleteSection,
  GetSection as _GetSection,
  ListSections as _ListSections,
  MoveSection as _MoveSection,
  OpenScenario as _OpenScenario,
  SaveSection as _SaveSection,
} from "../../wailsjs/go/main/App";
import { store } from "../../wailsjs/go/models";

export type Scenario = store.Scenario;
export type SectionMeta = store.SectionMeta;
export type Section = store.Section;
export type SaveResult = store.SaveResult;

export const openScenario = (): Promise<store.Scenario> => _OpenScenario();

export const listSections = (scenarioID: string): Promise<store.SectionMeta[]> =>
  _ListSections(scenarioID);

export const getSection = (id: string): Promise<store.Section> =>
  _GetSection(id);

export const saveSection = (
  id: string,
  body: string,
  rev: number
): Promise<store.SaveResult> => _SaveSection(id, body, rev);

export const createSection = (
  scenarioID: string,
  parentID: string,
  kind: string,
  title: string,
  afterID: string
): Promise<store.SectionMeta> =>
  _CreateSection(scenarioID, parentID, kind, title, afterID);

export const moveSection = (
  id: string,
  newParentID: string,
  afterID: string
): Promise<void> => _MoveSection(id, newParentID, afterID);

export const deleteSection = (id: string): Promise<void> => _DeleteSection(id);

export const ackFlush = (): Promise<void> => _AckFlush();
```

- [ ] **Step 3: TypeScript 型チェック**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし

---

## Task 9: `autosave.ts` — console.log スタブを実 SaveSection 呼び出しに置換

**Files:**
- Modify: `frontend/src/editor/autosave.ts`

- [ ] **Step 1: autosave.ts を完全置換**

`frontend/src/editor/autosave.ts`:

```typescript
import { EditorView } from "@codemirror/view";
import { saveSection } from "../api/bindings";
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
    saveSection(sectionId, body, rev)
      .then((res) => useScenarioStore.getState().markSaved(sectionId, res.rev))
      .catch((e) =>
        useScenarioStore.getState().markSaveError(sectionId, String(e))
      );
  };

  return EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    if (u.view.composing) return; // IME 変換確定前は保存しない

    useScenarioStore.getState().markDirty(sectionId);

    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;

    if (now - firstDirtyAt >= MAX_INTERVAL_MS) {
      flush(u.view);
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flush(u.view), IDLE_MS);
  });
}
```

- [ ] **Step 2: TypeScript 型チェック**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし

---

## Task 10: `frontend/src/components/Outline.tsx`

**Files:**
- Create: `frontend/src/components/Outline.tsx`

- [ ] **Step 1: components ディレクトリ確認**

```bash
ls /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/
```

`components/` が存在しない場合: `mkdir -p /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend/src/components`

- [ ] **Step 2: Outline.tsx を作成**

`frontend/src/components/Outline.tsx`:

```tsx
import { useScenarioStore, SectionEntry } from "../stores/scenarioStore";
import { useUIStore } from "../stores/uiStore";

interface OutlineProps {
  onSectionClick: (id: string) => void;
  onAddSection: () => void;
}

export function Outline({ onSectionClick, onAddSection }: OutlineProps) {
  const sections = useScenarioStore((s) => s.sections);
  const scenarioTitle = useScenarioStore((s) => s.scenarioTitle);
  const activeSectionId = useUIStore((s) => s.activeSectionId);

  const roots = sections
    .filter((s) => !s.parentId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0f172a",
        color: "#94a3b8",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          padding: "10px 12px 6px",
          fontWeight: 600,
          color: "#e2e8f0",
          borderBottom: "1px solid #1e293b",
        }}
      >
        {scenarioTitle || "シナリオ"}
      </div>
      <div style={{ padding: "6px 8px" }}>
        <button
          onClick={onAddSection}
          style={{
            width: "100%",
            padding: "4px 8px",
            background: "#1e3a5f",
            color: "#93c5fd",
            border: "1px solid #1d4ed8",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          + セクション追加
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {roots.map((section) => (
          <OutlineItem
            key={section.id}
            section={section}
            sections={sections}
            activeId={activeSectionId}
            onSectionClick={onSectionClick}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

interface OutlineItemProps {
  section: SectionEntry;
  sections: SectionEntry[];
  activeId: string | null;
  onSectionClick: (id: string) => void;
  depth: number;
}

function OutlineItem({
  section,
  sections,
  activeId,
  onSectionClick,
  depth,
}: OutlineItemProps) {
  const children = sections
    .filter((s) => s.parentId === section.id)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

  const isActive = section.id === activeId;

  return (
    <div>
      <div
        onClick={() => onSectionClick(section.id)}
        style={{
          paddingLeft: depth * 16 + 12,
          paddingTop: 5,
          paddingBottom: 5,
          paddingRight: 8,
          backgroundColor: isActive ? "#1e3a5f" : "transparent",
          color: isActive ? "#e2e8f0" : "#94a3b8",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.backgroundColor =
              "#1e293b";
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.backgroundColor =
              "transparent";
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {section.title}
        </span>
        {section.dirty && (
          <span style={{ color: "#f59e0b", fontSize: "10px" }}>●</span>
        )}
      </div>
      {children.map((child) => (
        <OutlineItem
          key={child.id}
          section={child}
          sections={sections}
          activeId={activeId}
          onSectionClick={onSectionClick}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript 型チェック**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし

---

## Task 11: `frontend/src/App.tsx` — 全体統合

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: App.tsx を完全置換**

`frontend/src/App.tsx`:

```tsx
import { useCallback, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { createEditorView } from "./editor/setup";
import { Outline } from "./components/Outline";
import { useScenarioStore } from "./stores/scenarioStore";
import { useUIStore } from "./stores/uiStore";
import * as API from "./api/bindings";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const setScenario = useScenarioStore((s) => s.setScenario);
  const setSections = useScenarioStore((s) => s.setSections);
  const upsertSection = useScenarioStore((s) => s.upsertSection);
  const scenarioId = useScenarioStore((s) => s.scenarioId);

  const activeSectionId = useUIStore((s) => s.activeSectionId);
  const setActiveSectionId = useUIStore((s) => s.setActiveSectionId);

  // Flush current editor content to the backend.
  const flushCurrent = useCallback(async () => {
    const id = useUIStore.getState().activeSectionId;
    if (!viewRef.current || !id) return;
    const store = useScenarioStore.getState();
    if (!store.isDirty(id)) return;
    const body = viewRef.current.state.doc.toString();
    const rev = store.revOf(id);
    try {
      const res = await API.saveSection(id, body, rev);
      store.markSaved(id, res.rev);
    } catch (e) {
      store.markSaveError(id, String(e));
    }
  }, []);

  // Load scenario and sections on mount.
  useEffect(() => {
    async function init() {
      const scenario = await API.openScenario();
      setScenario(scenario.id, scenario.title);
      const metas = await API.listSections(scenario.id);
      setSections(metas);
    }
    init();
  }, []);

  // Handle section switch: flush current → destroy editor → load new section → mount editor.
  const switchSection = useCallback(
    async (id: string) => {
      if (id === useUIStore.getState().activeSectionId) return;
      await flushCurrent();

      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }

      const section = await API.getSection(id);
      setActiveSectionId(id);

      if (containerRef.current) {
        viewRef.current = createEditorView(
          containerRef.current,
          section.body,
          id
        );
      }
    },
    [flushCurrent]
  );

  // Auto-select first section when sections load and none is active.
  const sections = useScenarioStore((s) => s.sections);
  useEffect(() => {
    if (sections.length > 0 && !useUIStore.getState().activeSectionId) {
      const first = [...sections].sort((a, b) =>
        a.sortKey < b.sortKey ? -1 : 1
      )[0];
      switchSection(first.id);
    }
  }, [sections.length]);

  // Flush on window blur.
  useEffect(() => {
    window.addEventListener("blur", flushCurrent);
    return () => window.removeEventListener("blur", flushCurrent);
  }, [flushCurrent]);

  // Flush before app close.
  useEffect(() => {
    const off = EventsOn("beforeClose", async () => {
      await flushCurrent();
      await API.ackFlush();
    });
    return off;
  }, [flushCurrent]);

  // Add a new section at the end.
  const handleAddSection = useCallback(async () => {
    const sid = useScenarioStore.getState().scenarioId;
    if (!sid) return;
    const secs = useScenarioStore.getState().sections;
    const lastId =
      secs.length > 0
        ? [...secs].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1)).at(-1)!
            .id
        : "";
    const meta = await API.createSection(
      sid,
      "",
      "scene",
      "新規セクション",
      lastId
    );
    upsertSection(meta);
    await switchSection(meta.id);
  }, [switchSection]);

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <Outline
          onSectionClick={switchSection}
          onAddSection={handleAddSection}
        />
      </div>

      {/* Editor pane */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {activeSectionId === null && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#475569",
              fontSize: "14px",
            }}
          >
            セクションを選択するか「+ セクション追加」をクリックしてください
          </div>
        )}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "auto",
            display: activeSectionId !== null ? "block" : "none",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 型チェック**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npx tsc --noEmit 2>&1 | grep -v ExperimentalWarning
```

期待値: エラーなし

- [ ] **Step 3: フロントエンドビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/frontend
npm run build 2>&1 | tail -8
```

期待値: `dist/` 生成完了、エラーなし

---

## Task 12: M1 完了コミット

- [ ] **Step 1: 全体ビルド最終確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./... && echo "Go: OK"
cd frontend && npm run build 2>&1 | tail -3
```

期待値: `Go: OK` + `dist/` 生成

- [ ] **Step 2: コミット**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
git add \
  internal/store/sortkey.go \
  internal/store/scenario.go \
  internal/store/section.go \
  internal/store/store_test.go \
  app.go \
  main.go \
  frontend/wailsjs/go/models.ts \
  frontend/wailsjs/go/main/App.d.ts \
  frontend/wailsjs/go/main/App.js \
  frontend/src/stores/scenarioStore.ts \
  frontend/src/stores/uiStore.ts \
  frontend/src/api/bindings.ts \
  frontend/src/editor/autosave.ts \
  frontend/src/components/Outline.tsx \
  frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat: M1 編集基盤 — セクション CRUD・アウトライン UI・実オートセーブ

- sortkey.go: fractional indexing KeyBetween (base62, lexicographic)
- scenario.go: Scenario 型 + GetOrCreateDefaultScenario
- section.go: SectionMeta/Section/SaveResult + CRUD + 楽観ロック
- store_test.go: KeyBetween 単体テスト + ストア統合テスト
- app.go: OpenScenario/ListSections/GetSection/SaveSection/CreateSection/
           MoveSection/DeleteSection + AckFlush + beforeClose (2s timeout)
- main.go: OnBeforeClose フック追加
- Wails バインディング (models.ts, App.d.ts, App.js): 新型を手動反映
- scenarioStore.ts: メタ・dirty・rev のみ管理（本文は CM6 に閉じ込め）
- uiStore.ts: activeSectionId 管理
- bindings.ts: Wails 呼び出し型付きラッパー
- autosave.ts: console.log スタブ → 実 SaveSection + 楽観ロック対応
- Outline.tsx: セクションツリー表示・クリックで切り替え
- App.tsx: 起動読み込み・セクション切り替え・blur/beforeClose フラッシュ

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `cmd/seed/main.go` + パフォーマンス検証

**Files:**
- Create: `cmd/seed/main.go`

- [ ] **Step 1: cmd/seed/ ディレクトリ作成と seed スクリプト作成**

```bash
mkdir -p /Users/nakamuranatsu/Desktop/develop/tool/micho-edit/cmd/seed
```

`cmd/seed/main.go`:

```go
package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// body400 is approximately 400 Japanese characters (≈ 1,200 bytes UTF-8).
var body400 = strings.Repeat(
	"あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん。",
	8,
)

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	dbPath := filepath.Join(home, ".trpg-editor", "default.trpg")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	scenarioID := uuid.New().String()
	now := time.Now().UnixMilli()

	_, err = db.Exec(
		`INSERT INTO scenarios(id, title, system, players, play_time, meta, created_at, updated_at)
		 VALUES (?, 'パフォーマンス計測用シナリオ', 'CoC7', '4人', '4時間', '{}', ?, ?)`,
		scenarioID, now, now,
	)
	if err != nil {
		panic(fmt.Errorf("insert scenario: %w", err))
	}

	tx, err := db.Begin()
	if err != nil {
		panic(err)
	}

	for i := 0; i < 500; i++ {
		id := uuid.New().String()
		sortKey := fmt.Sprintf("%010d", i)
		_, err = tx.Exec(
			`INSERT INTO sections(id, scenario_id, parent_id, kind, title, body, sort_key, rev, updated_at)
			 VALUES (?, ?, NULL, 'scene', ?, ?, ?, 1, ?)`,
			id, scenarioID, fmt.Sprintf("シーン %d", i+1), body400, sortKey, now,
		)
		if err != nil {
			_ = tx.Rollback()
			panic(fmt.Errorf("insert section %d: %w", i, err))
		}
		if (i+1)%100 == 0 {
			fmt.Printf("Inserted %d / 500 sections\n", i+1)
		}
	}

	if err := tx.Commit(); err != nil {
		panic(err)
	}

	totalChars := 500 * len([]rune(body400))
	fmt.Printf("Seed complete: scenarioID=%s, sections=500, ~%d chars\n",
		scenarioID, totalChars)
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go build ./cmd/seed/...
```

期待値: エラーなし

- [ ] **Step 3: シードデータ生成（ユーザーが実行）**

```bash
export PATH="$PATH:$HOME/go/bin"
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
go run ./cmd/seed/main.go
```

期待値:
```
Inserted 100 / 500 sections
Inserted 200 / 500 sections
...
Seed complete: scenarioID=xxxx, sections=500, ~200000 chars
```

- [ ] **Step 4: wails dev でアプリ起動・パフォーマンス計測（ユーザーが実行）**

```bash
export PATH="$PATH:$HOME/go/bin"
wails dev
```

1. アプリウィンドウが開いたら `Cmd+Shift+I` でデベロッパーツールを開く
2. Performance タブ → Record → エディタで数十文字入力 → Stop
3. キーストロークのイベントと次の描画フレームの間隔を確認

**期待値:**
- 入力レイテンシ (keystroke → paint) < 16ms ✓
- アウトラインに 500 セクションが表示される ✓
- セクションクリックで 100ms 以内に本文がロードされる ✓
- 変更後 800ms で `[autosave]` ではなく実際の保存が走る（エラーなし） ✓

- [ ] **Step 5: seed スクリプトをコミット**

```bash
cd /Users/nakamuranatsu/Desktop/develop/tool/micho-edit
git add cmd/seed/main.go
git commit -m "$(cat <<'EOF'
chore: add seed script for M1 performance verification (500 sections / ~200k chars)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review チェック

### Spec coverage

| 要件 (STEP.md) | 実装 |
|---|---|
| `internal/store/scenario.go` — シナリオ CRUD | Task 2 |
| `internal/store/section.go` — SectionMeta 型分離 + CRUD | Task 3 |
| `SaveSection` 楽観ロック (WHERE rev=? / Conflict) | Task 3 |
| fractional indexing sort_key ヘルパー | Task 1 |
| `app.go` — 8 公開 API | Task 5 |
| `scenarioStore.ts` — メタ・dirty・rev のみ | Task 7 |
| `uiStore.ts` — UI 状態 | Task 7 |
| `api/bindings.ts` — 型付きラッパー | Task 8 |
| `Outline.tsx` — ツリー表示・クリック切り替え | Task 10 |
| `autosave.ts` — 800ms debounce + 5s flush | Task 9 |
| セクション切り替え時フラッシュ | Task 11 |
| window blur 時フラッシュ | Task 11 |
| `BeforeClose` フック + AckFlush | Task 5 + 11 |
| 500 セクション / 20 万字ダミーデータ | Task 13 |
| キーストロークレイテンシ < 16ms 計測 | Task 13 Step 4 |

### 注意事項

- `COALESCE(parent_id,'')` を使うことで NULL と空文字を統一的に扱っている。Go 側でも `parentId` は `""` で top-level を表す。
- `body400` は約 400 文字 × 500 セクション = 20 万字。UTF-8 バイト数は 3 倍になるが sort_key が数値パディング形式のため ListSections の ORDER BY は正しく動く。
- Wails バインディングファイル (`wailsjs/`) は `wails dev` 実行時に自動上書きされる。手動で書いた内容と一致するはずだが、差異が出た場合は自動生成を優先する。
- `autosave.ts` の SaveSection は fire-and-forget。セクション切り替えとの競合（両方が同 rev で保存しようとする）は楽観ロックで検知されるが、M1 では致命的ではない（直前のオートセーブが成功していれば、切り替え時フラッシュが競合しても本文は保存済み）。
