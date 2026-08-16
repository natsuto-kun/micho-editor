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

// findSortKey returns a sort_key for insertion after afterID within the given parent scope.
// afterID="" means insert before all others (find key before the current first).
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
