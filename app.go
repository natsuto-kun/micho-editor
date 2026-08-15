package main

import (
	"context"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"trpg-editor/internal/store"
)

type App struct {
	ctx   context.Context
	store *store.Store
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

func (a *App) Store() *store.Store {
	return a.store
}
