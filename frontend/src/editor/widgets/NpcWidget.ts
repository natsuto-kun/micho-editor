import { WidgetType } from "@codemirror/view";

export class NpcWidget extends WidgetType {
  constructor(
    readonly params: string,
    readonly body: string
  ) {
    super();
  }

  eq(other: NpcWidget): boolean {
    return other.params === this.params && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const [name = "", role = "", age = ""] = this.params
      .split("|")
      .map((p) => p.trim());

    const container = document.createElement("div");
    container.className = "directive-npc";

    const header = document.createElement("div");
    header.className = "directive-npc__header";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "NPC";

    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;

    header.append(badge, nameEl);

    const table = document.createElement("table");
    table.className = "directive-npc__attrs";

    for (const [label, value] of [
      ["役職", role],
      ["年齢", age],
    ] as [string, string][]) {
      if (!value) continue;
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = label;
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(th, td);
      table.append(tr);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-npc__body";
    bodyEl.textContent = this.body;

    container.append(header, table, bodyEl);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
