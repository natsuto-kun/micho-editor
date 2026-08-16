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
