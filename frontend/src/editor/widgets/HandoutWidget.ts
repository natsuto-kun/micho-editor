import { WidgetType, EditorView } from "@codemirror/view";

export class HandoutWidget extends WidgetType {
  constructor(
    readonly params: string,
    readonly body: string
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof HandoutWidget &&
      other.params === this.params &&
      other.body === this.body
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const [id = "", target = ""] = this.params
      .split("|")
      .map((p) => p.trim());

    const container = document.createElement("div");
    container.className = "directive-handout";

    const header = document.createElement("div");
    header.className = "directive-handout__header";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "HANDOUT";

    const idEl = document.createElement("span");
    idEl.className = "id";
    idEl.textContent = id;

    header.append(badge, idEl);

    if (target) {
      const targetEl = document.createElement("span");
      targetEl.className = "target";
      targetEl.textContent = `→ ${target}`;
      header.append(targetEl);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-handout__body";
    bodyEl.textContent = this.body;

    container.append(header, bodyEl);
    return container;
  }

  ignoreEvent(_event: Event): boolean {
    return false;
  }
}
