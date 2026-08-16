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

func TestKeyBetweenError(t *testing.T) {
	// lo >= hi must return an error
	_, err := store.KeyBetween("a1", "a0")
	if err == nil {
		t.Error("KeyBetween(\"a1\",\"a0\") should return error but got nil")
	}
	// Equal lo and hi must also return an error
	_, err = store.KeyBetween("a0", "a0")
	if err == nil {
		t.Error("KeyBetween(\"a0\",\"a0\") should return error but got nil")
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
