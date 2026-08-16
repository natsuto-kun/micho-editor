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
