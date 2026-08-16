import { useRef, useState, useEffect } from "react";
import * as API from "../api/bindings";
import { SearchHit } from "../api/bindings";

interface Props {
  scenarioId: string;
  onHitClick: (sectionId: string) => void;
  onClose: () => void;
}

export function SearchPanel({ scenarioId, onHitClick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    window.clearTimeout(timerRef.current);
    if (q.length === 0) {
      setHits([]);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      try {
        const results = await API.searchSections(scenarioId, q, 20);
        setHits(results);
      } catch {
        // silently ignore errors (e.g. during section switch)
      }
    }, 300);
  };

  return (
    <>
      <style>{`
        .search-snip mark {
          background: #f59e0b;
          color: #000;
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          maxHeight: "40vh",
          overflow: "auto",
          padding: "8px",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            autoFocus
            value={query}
            onChange={handleChange}
            placeholder="検索… (Esc で閉じる)"
            style={{
              flex: 1,
              background: "#0f172a",
              border: "1px solid #475569",
              borderRadius: 4,
              color: "#e2e8f0",
              padding: "5px 10px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 6px",
            }}
          >
            ×
          </button>
        </div>

        {query.length > 0 && hits.length === 0 && (
          <div style={{ color: "#475569", fontSize: 12, padding: "4px 8px" }}>
            結果なし
          </div>
        )}

        {hits.map((hit) => (
          <div
            key={hit.id}
            onClick={() => { onHitClick(hit.id); onClose(); }}
            style={{
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#334155")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 10,
                  background: "#475569",
                  color: "#94a3b8",
                  padding: "1px 5px",
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              >
                {hit.kind}
              </span>
              <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>
                {hit.title}
              </span>
            </div>
            {hit.snip && (
              <div
                className="search-snip"
                style={{ color: "#94a3b8", fontSize: 12 }}
                dangerouslySetInnerHTML={{ __html: hit.snip }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
