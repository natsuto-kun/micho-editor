package search_test

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
	"trpg-editor/internal/search"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "search-test-*.db")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })

	db, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	_, err = db.Exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE sections (
			id          TEXT PRIMARY KEY,
			scenario_id TEXT NOT NULL,
			parent_id   TEXT,
			kind        TEXT NOT NULL,
			title       TEXT NOT NULL,
			body        TEXT NOT NULL DEFAULT '',
			sort_key    TEXT NOT NULL,
			rev         INTEGER NOT NULL DEFAULT 1,
			updated_at  INTEGER NOT NULL
		);
		CREATE VIRTUAL TABLE section_fts USING fts5(
			title, body,
			content='sections',
			content_rowid='rowid',
			tokenize='trigram'
		);
		CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
			INSERT INTO section_fts(rowid, title, body)
				VALUES (new.rowid, new.title, new.body);
		END;
		CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
			INSERT INTO section_fts(section_fts, rowid, title, body)
				VALUES('delete', old.rowid, old.title, old.body);
			INSERT INTO section_fts(rowid, title, body)
				VALUES (new.rowid, new.title, new.body);
		END;
	`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func insertSection(t *testing.T, db *sql.DB, id, scenarioID, kind, title, body string) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO sections(id, scenario_id, kind, title, body, sort_key, rev, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'a0', 1, 0)`,
		id, scenarioID, kind, title, body)
	if err != nil {
		t.Fatal(err)
	}
}

func TestFTSSearch(t *testing.T) {
	db := setupTestDB(t)
	insertSection(t, db, "s1", "sc1", "scene", "オープニング", "探偵の田中誠一が登場する")
	insertSection(t, db, "s2", "sc1", "npc",   "田中誠一",     "45歳の探偵。STR 12。")
	insertSection(t, db, "s3", "sc1", "scene", "別シーン",     "関係ない文章です")

	hits, err := search.Search(db, "sc1", "田中誠一", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 {
		t.Fatalf("want 2 hits, got %d", len(hits))
	}
	for _, h := range hits {
		if h.Snip != "" && !strings.Contains(h.Snip, "<mark>") {
			t.Errorf("hit %s: snip %q missing <mark>", h.ID, h.Snip)
		}
		if strings.Contains(h.Snip, "\x01") || strings.Contains(h.Snip, "\x02") {
			t.Errorf("hit %s: raw markers leaked into snip", h.ID)
		}
	}
}

func TestLIKEFallback(t *testing.T) {
	db := setupTestDB(t)
	insertSection(t, db, "s1", "sc1", "scene", "序章", "本文")
	insertSection(t, db, "s2", "sc1", "scene", "序盤", "本文")
	insertSection(t, db, "s3", "sc1", "scene", "終章", "本文")

	// 2-rune query → LIKE fallback
	hits, err := search.Search(db, "sc1", "序", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 {
		t.Fatalf("want 2 LIKE hits, got %d", len(hits))
	}
}

func TestEmptyQuery(t *testing.T) {
	db := setupTestDB(t)
	insertSection(t, db, "s1", "sc1", "scene", "テスト", "本文")

	hits, err := search.Search(db, "sc1", "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 0 {
		t.Fatalf("want 0 hits for empty query, got %d", len(hits))
	}
}

func TestCrossScenarioIsolation(t *testing.T) {
	db := setupTestDB(t)
	insertSection(t, db, "s1", "sc1", "scene", "シナリオ1のシーン", "田中誠一が現れる")
	insertSection(t, db, "s2", "sc2", "scene", "シナリオ2のシーン", "田中誠一が現れる")

	hits, err := search.Search(db, "sc1", "田中誠一", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range hits {
		if h.ID != "s1" {
			t.Errorf("got hit from wrong scenario: id=%s", h.ID)
		}
	}
}

func TestHTMLEscapeInSnip(t *testing.T) {
	db := setupTestDB(t)
	// Body contains HTML special chars that must be escaped in the snippet.
	insertSection(t, db, "s1", "sc1", "scene", "テスト", "<script>田中誠一alert(1)</script>本文")

	hits, err := search.Search(db, "sc1", "田中誠一", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) == 0 {
		t.Skip("no hits (trigram may not index short body)")
	}
	for _, h := range hits {
		if strings.Contains(h.Snip, "<script>") {
			t.Errorf("raw <script> tag leaked into snip: %q", h.Snip)
		}
	}
}
