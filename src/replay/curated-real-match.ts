import type { MatchDefinition } from "../core/types.js";

/**
 * This tracked placeholder is intentionally empty.
 *
 * Run the authenticated curated completed-match exporter locally to replace it
 * with one allowlisted MatchShift MatchDefinition. The generated module contains
 * no raw TxLINE payload, provider fixture/message identifiers, or credentials.
 */
export const CURATED_REAL_MATCH: MatchDefinition | undefined = undefined;
