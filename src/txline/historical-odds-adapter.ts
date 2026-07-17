type UnknownRecord = Record<string, unknown>;

const KNOWN_WINNER_MARKETS = new Set([
  "1x2",
  "matchwinner",
  "fulltimematchwinner",
  "soccer1x2"
]);

const ACCEPTED_PERIODS = new Set([
  "",
  "match",
  "fullmatch",
  "fulltime",
  "regulartime",
  "ft"
]);

const DRAW_LABELS = new Set(["draw", "x", "tie", "thedraw", "0"]);

export interface HistoricalOddsStructuralClassification {
  isRecord: boolean;
  marketTypePresent: boolean;
  alreadySupportedWinnerMarket: boolean;
  marketParametersEmpty: boolean;
  marketPeriodAccepted: boolean;
  priceNamesArity: number;
  explicitWinnerLabels: boolean;
  namedWinnerLabels: boolean;
  adapterEligible: boolean;
}

interface WinnerLabelClassification {
  explicit: boolean;
  namedSidesWithMiddleDraw: boolean;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function canonicalLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function marketParametersEmpty(record: UnknownRecord): boolean {
  return (
    readString(record.MarketParameters ?? record.marketParameters) ?? ""
  ) === "";
}

function marketPeriodAccepted(record: UnknownRecord): boolean {
  const period = canonicalLabel(
    readString(record.MarketPeriod ?? record.marketPeriod) ?? ""
  );
  return ACCEPTED_PERIODS.has(period);
}

function classifyWinnerLabels(value: unknown): WinnerLabelClassification {
  if (!Array.isArray(value) || value.length !== 3) {
    return { explicit: false, namedSidesWithMiddleDraw: false };
  }
  if (
    value.some(
      (item) => typeof item !== "string" || item.trim() === ""
    )
  ) {
    return { explicit: false, namedSidesWithMiddleDraw: false };
  }

  const labels = (value as string[]).map(canonicalLabel);
  if (new Set(labels).size !== 3) {
    return { explicit: false, namedSidesWithMiddleDraw: false };
  }

  const direct =
    labels.includes("home") &&
    DRAW_LABELS.has(labels[1] ?? "") &&
    labels.includes("away");
  const participantBased =
    (labels[0] === "1" || labels[0] === "participant1") &&
    DRAW_LABELS.has(labels[1] ?? "") &&
    (labels[2] === "2" || labels[2] === "participant2");
  const explicit = direct || participantBased;
  const namedSidesWithMiddleDraw =
    !explicit &&
    DRAW_LABELS.has(labels[1] ?? "") &&
    !DRAW_LABELS.has(labels[0] ?? "") &&
    !DRAW_LABELS.has(labels[2] ?? "");

  return { explicit, namedSidesWithMiddleDraw };
}

export function classifyHistoricalOddsStructure(
  value: unknown
): HistoricalOddsStructuralClassification {
  const record = asRecord(value);
  if (record === undefined) {
    return {
      isRecord: false,
      marketTypePresent: false,
      alreadySupportedWinnerMarket: false,
      marketParametersEmpty: false,
      marketPeriodAccepted: false,
      priceNamesArity: 0,
      explicitWinnerLabels: false,
      namedWinnerLabels: false,
      adapterEligible: false
    };
  }

  const marketType = readString(record.SuperOddsType ?? record.superOddsType);
  const alreadySupportedWinnerMarket =
    marketType !== undefined && KNOWN_WINNER_MARKETS.has(canonicalLabel(marketType));
  const rawPriceNames = record.PriceNames ?? record.priceNames;
  const priceNamesArity = Array.isArray(rawPriceNames) ? rawPriceNames.length : 0;
  const parametersEmpty = marketParametersEmpty(record);
  const periodAccepted = marketPeriodAccepted(record);
  const winnerLabels = classifyWinnerLabels(rawPriceNames);

  return {
    isRecord: true,
    marketTypePresent: marketType !== undefined,
    alreadySupportedWinnerMarket,
    marketParametersEmpty: parametersEmpty,
    marketPeriodAccepted: periodAccepted,
    priceNamesArity,
    explicitWinnerLabels: winnerLabels.explicit,
    namedWinnerLabels: winnerLabels.namedSidesWithMiddleDraw,
    adapterEligible:
      marketType !== undefined &&
      !alreadySupportedWinnerMarket &&
      parametersEmpty &&
      periodAccepted &&
      (winnerLabels.explicit || winnerLabels.namedSidesWithMiddleDraw)
  };
}

function adaptRecord(value: unknown): unknown {
  const record = asRecord(value);
  if (record === undefined) {
    return value;
  }

  const classification = classifyHistoricalOddsStructure(record);
  if (!classification.adapterEligible) {
    return value;
  }

  const marketType = readString(record.SuperOddsType ?? record.superOddsType);
  if (marketType === undefined) {
    return value;
  }

  const adapted: UnknownRecord = {
    ...record,
    HistoricalSourceSuperOddsType: marketType,
    SuperOddsType: "1X2"
  };
  if (classification.namedWinnerLabels) {
    delete adapted.priceNames;
    adapted.PriceNames = ["Home", "Draw", "Away"];
  }
  return adapted;
}

export function adaptHistoricalOddsPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(adaptRecord);
  }
  return adaptRecord(value);
}
