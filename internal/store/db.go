package store

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DB() *sql.DB {
	return s.db
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	files, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)

	for _, file := range files {
		version := strings.TrimSuffix(filepath.Base(file), ".sql")

		var exists bool
		if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)`, version).Scan(&exists); err != nil {
			return fmt.Errorf("check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		sql, err := fs.ReadFile(migrationsFS, file)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", file, err)
		}

		if _, err := s.db.Exec(string(sql)); err != nil {
			return fmt.Errorf("apply migration %s: %w", version, err)
		}

		if _, err := s.db.Exec(
			`INSERT INTO schema_migrations(version, applied_at) VALUES (?, strftime('%s','now'))`,
			version,
		); err != nil {
			return fmt.Errorf("record migration %s: %w", version, err)
		}
	}
	return nil
}
