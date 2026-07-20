import type {
  EventCategory,
  EventImportance,
  MatchEventType,
  TeamSide
} from "../core/types.js";

export type RichEventTuple = readonly [
  MatchEventType,
  number,
  number,
  string,
  string,
  EventImportance,
  EventCategory,
  TeamSide | null,
  string | null,
  string | null
];
