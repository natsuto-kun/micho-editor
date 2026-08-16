package search

import (
	"database/sql"
	"html"
	"strings"
)

// Hit is a single search result with a highlighted body snippet.
type Hit struct {
	ID    string  `json:"id"`
	Title string  `json:"title"`
	Kind  string  `json:"kind"`
	Snip  string  `json:"snip"` // HTML with <mark> tags; empty for title-only matches
	Score float64 `json:"score"`
}

// Search searches sections within a scenario. Queries with ≥3 runes use FTS5; shorter
// queries fall back to a title LIKE search. Limit caps results (typically 20).
func Search(db *sql.DB, scenarioID, q string, limit int) ([]Hit, error) {
	if q == "" {
		return []Hit{}, nil
	}
	if len([]rune(q)) >= 3 {
		return ftsSearch(db, scenarioID, q, limit)
	}
	return likeSearch(db, scenarioID, q, limit)
}

func ftsSearch(db *sql.DB, scenarioID, q string, limit int) ([]Hit, error) {
	// Use control chars as markers so we can safely HTML-escape content first.
	const open, close = "\x01", "\x02"
	// Phrase query: wrap in double-quotes, escaping any internal double-quotes.
	ftsQuery := `"` + strings.ReplaceAll(q, `"`, `""`) + `"`

	// Fetch snippets for both title (col 0) and body (col 1). We'll pick the
	// one that contains markers (i.e., the column that actually matched).
	rows, err := db.Query(`
		SELECT sec.id, sec.title, sec.kind,
		       snippet(section_fts, 0, ?, ?, '…', 24) AS title_snip,
		       snippet(section_fts, 1, ?, ?, '…', 24) AS body_snip,
		       bm25(section_fts) AS score
		  FROM section_fts
		  JOIN sections sec ON sec.rowid = section_fts.rowid
		 WHERE section_fts MATCH ?
		   AND sec.scenario_id = ?
		 ORDER BY score
		 LIMIT ?`,
		open, close, open, close, ftsQuery, scenarioID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanFTSHits(rows)
}

// scanFTSHits reads rows that include both title_snip and body_snip columns,
// selecting the snippet that contains match markers.
func scanFTSHits(rows *sql.Rows) ([]Hit, error) {
	const marker = "\x01"
	var hits []Hit
	for rows.Next() {
		var h Hit
		var titleSnip, bodySnip string
		if err := rows.Scan(&h.ID, &h.Title, &h.Kind, &titleSnip, &bodySnip, &h.Score); err != nil {
			return nil, err
		}
		// Prefer body snippet if it contains a match marker; otherwise use title snippet.
		rawSnip := bodySnip
		if !strings.Contains(rawSnip, marker) {
			rawSnip = titleSnip
		}
		escaped := html.EscapeString(rawSnip)
		h.Snip = strings.NewReplacer("\x01", "<mark>", "\x02", "</mark>").Replace(escaped)
		hits = append(hits, h)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if hits == nil {
		hits = []Hit{}
	}
	return hits, nil
}

func likeSearch(db *sql.DB, scenarioID, q string, limit int) ([]Hit, error) {
	rows, err := db.Query(`
		SELECT id, title, kind, '' AS snip, 0.0 AS score
		  FROM sections
		 WHERE scenario_id = ?
		   AND title LIKE ?
		 LIMIT ?`,
		scenarioID, "%"+q+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHits(rows)
}

func scanHits(rows *sql.Rows) ([]Hit, error) {
	var hits []Hit
	for rows.Next() {
		var h Hit
		var rawSnip string
		if err := rows.Scan(&h.ID, &h.Title, &h.Kind, &rawSnip, &h.Score); err != nil {
			return nil, err
		}
		// HTML-escape the raw text, then restore marker tags as safe HTML.
		escaped := html.EscapeString(rawSnip)
		h.Snip = strings.NewReplacer("\x01", "<mark>", "\x02", "</mark>").Replace(escaped)
		hits = append(hits, h)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if hits == nil {
		hits = []Hit{}
	}
	return hits, nil
}
