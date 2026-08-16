import {
  AckFlush as _AckFlush,
  CreateSection as _CreateSection,
  DeleteSection as _DeleteSection,
  GetSection as _GetSection,
  ListSections as _ListSections,
  MoveSection as _MoveSection,
  OpenScenario as _OpenScenario,
  SaveSection as _SaveSection,
} from "../../wailsjs/go/main/App";
import { store } from "../../wailsjs/go/models";

export type Scenario = store.Scenario;
export type SectionMeta = store.SectionMeta;
export type Section = store.Section;
export type SaveResult = store.SaveResult;

export const openScenario = (): Promise<store.Scenario> => _OpenScenario();

export const listSections = (scenarioID: string): Promise<store.SectionMeta[]> =>
  _ListSections(scenarioID);

export const getSection = (id: string): Promise<store.Section> =>
  _GetSection(id);

export const saveSection = (
  id: string,
  body: string,
  rev: number
): Promise<store.SaveResult> => _SaveSection(id, body, rev);

export const createSection = (
  scenarioID: string,
  parentID: string,
  kind: string,
  title: string,
  afterID: string
): Promise<store.SectionMeta> =>
  _CreateSection(scenarioID, parentID, kind, title, afterID);

export const moveSection = (
  id: string,
  newParentID: string,
  afterID: string
): Promise<void> => _MoveSection(id, newParentID, afterID);

export const deleteSection = (id: string): Promise<void> => _DeleteSection(id);

export const ackFlush = (): Promise<void> => _AckFlush();
