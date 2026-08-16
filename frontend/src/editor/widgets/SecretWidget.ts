import { WidgetType, EditorView } from "@codemirror/view";

export class SecretWidget extends WidgetType {
  constructor(readonly body: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof SecretWidget && other.body === this.body;
  }

  toDOM(_view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "directive-secret";

    const label = document.createElement("div");
    label.className = "directive-secret__label";
    label.textContent = "▓ SECRET";

    const bodyEl = document.createElement("div");
    bodyEl.className = "directive-secret__body";
    bodyEl.textContent = this.body;

    container.append(label, bodyEl);
    return container;
  }

  ignoreEvent(_event: Event): boolean {
    return false;
  }
}
