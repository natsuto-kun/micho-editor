import { useScenarioStore, SectionEntry } from "../stores/scenarioStore";
import { useUIStore } from "../stores/uiStore";

interface OutlineProps {
  onSectionClick: (id: string) => void;
  onAddSection: () => void;
}

export function Outline({ onSectionClick, onAddSection }: OutlineProps) {
  const sections = useScenarioStore((s) => s.sections);
  const scenarioTitle = useScenarioStore((s) => s.scenarioTitle);
  const activeSectionId = useUIStore((s) => s.activeSectionId);

  const roots = sections
    .filter((s) => !s.parentId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0f172a",
        color: "#94a3b8",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          padding: "10px 12px 6px",
          fontWeight: 600,
          color: "#e2e8f0",
          borderBottom: "1px solid #1e293b",
        }}
      >
        {scenarioTitle || "シナリオ"}
      </div>
      <div style={{ padding: "6px 8px" }}>
        <button
          onClick={onAddSection}
          style={{
            width: "100%",
            padding: "4px 8px",
            background: "#1e3a5f",
            color: "#93c5fd",
            border: "1px solid #1d4ed8",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          + セクション追加
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {roots.map((section) => (
          <OutlineItem
            key={section.id}
            section={section}
            sections={sections}
            activeId={activeSectionId}
            onSectionClick={onSectionClick}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

interface OutlineItemProps {
  section: SectionEntry;
  sections: SectionEntry[];
  activeId: string | null;
  onSectionClick: (id: string) => void;
  depth: number;
}

function OutlineItem({
  section,
  sections,
  activeId,
  onSectionClick,
  depth,
}: OutlineItemProps) {
  const children = sections
    .filter((s) => s.parentId === section.id)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

  const isActive = section.id === activeId;

  return (
    <div>
      <div
        onClick={() => onSectionClick(section.id)}
        style={{
          paddingLeft: depth * 16 + 12,
          paddingTop: 5,
          paddingBottom: 5,
          paddingRight: 8,
          backgroundColor: isActive ? "#1e3a5f" : "transparent",
          color: isActive ? "#e2e8f0" : "#94a3b8",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.backgroundColor =
              "#1e293b";
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.backgroundColor =
              "transparent";
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {section.title}
        </span>
        {section.dirty && (
          <span style={{ color: "#f59e0b", fontSize: "10px" }}>●</span>
        )}
      </div>
      {children.map((child) => (
        <OutlineItem
          key={child.id}
          section={child}
          sections={sections}
          activeId={activeId}
          onSectionClick={onSectionClick}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
