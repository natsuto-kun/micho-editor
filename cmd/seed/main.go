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
