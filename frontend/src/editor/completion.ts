import {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { listSections } from "../api/bindings";
import { useScenarioStore } from "../stores/scenarioStore";

let cachedScenarioId = "";
let sectionTitleCache: string[] = [];
let lastCacheFetchMs = 0;
const CACHE_TTL_MS = 30_000;

async function getSectionTitles(): Promise<string[]> {
  const now = Date.now();
  const scenarioId = useScenarioStore.getState().scenarioId;
  if (!scenarioId) return [];
  if (
    sectionTitleCache.length > 0 &&
    scenarioId === cachedScenarioId &&
    now - lastCacheFetchMs < CACHE_TTL_MS
  ) {
    return sectionTitleCache;
  }
  const sections = await listSections(scenarioId);
  cachedScenarioId = scenarioId;
  sectionTitleCache = sections.map((s) => s.title);
  lastCacheFetchMs = now;
  return sectionTitleCache;
}

export async function directiveCompletion(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  // ::: ディレクティブ補完（閉じ ::: は除外：\w+ で 1 文字以上必須）
  const directiveMatch = textBefore.match(/^:::(\w+)$/);
  if (directiveMatch) {
    const query = directiveMatch[1];
    return {
      from: context.pos - query.length,
      options: [
        { label: "npc", apply: "npc Name | Role | Age\n\n:::" },
        { label: "handout", apply: "handout HO1 | PlayerA\n\n:::" },
        { label: "secret", apply: "secret\n\n:::" },
      ],
      validFor: /^\w*$/,
    };
  }

  // [[WikiLink]] 補完
  const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
  if (wikiMatch) {
    const query = wikiMatch[1];
    const titles = await getSectionTitles();
    return {
      from: context.pos - query.length,
      options: titles.map((t) => ({ label: t, apply: t + "]]" })),
      validFor: /^[^\]]*$/,
    };
  }

  // @NPC 補完
  const npcMatch = textBefore.match(/@([^\s@]*)$/);
  if (npcMatch) {
    const query = npcMatch[1];
    const docText = context.state.doc.toString();
    const npcNames = [
      ...docText.matchAll(/^:::npc\s+([^|\n]+)/gm),
    ]
      .map((m) => m[1].trim())
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return {
      from: context.pos - query.length - 1,
      options: npcNames.map((n) => ({ label: n, apply: "@" + n })),
    };
  }

  // #tag 補完（Markdown 見出しは除外）
  const tagMatch = textBefore.match(/#([^\s#]*)$/);
  if (tagMatch) {
    const query = tagMatch[1];
    const docText = context.state.doc.toString();
    const tags = docText
      .split("\n")
      .filter((l) => !/^#+\s/.test(l))
      .flatMap((l) => [...l.matchAll(/#([^\s#]+)/g)].map((m) => m[1]))
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return {
      from: context.pos - query.length - 1,
      options: tags.map((t) => ({ label: t, apply: "#" + t })),
    };
  }

  return null;
}
