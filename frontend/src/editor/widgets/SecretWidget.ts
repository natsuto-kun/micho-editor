import { WidgetType } from "@codemirror/view";

export class SecretWidget extends WidgetType {
  constructor(readonly body: string) {
    super();
  }

  eq(other: SecretWidget): boolean {
    return other.body === this.body;
  }

  toDOM(): HTMLElement {
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

  ignoreEvent(): boolean {
    return false;
  }
}
