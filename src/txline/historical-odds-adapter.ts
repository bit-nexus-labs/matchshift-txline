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

export interface HistoricalOddsStructuralClassification {
  isRecord: boolean;
  marketTypePresent: boolean;
  alreadySupportedWinnerMarket: boolean;
  marketParametersEmpty: boolean;
  marketPeriodAccepted: boolean;
  priceNamesArity: number;
  explicitWinnerLabels: boolean;
  adapterEligible: boolean;
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

function explicitWinnerLabels(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }
  if (value.some((item) => typeof item !== "string")) {
    return false;
  }

  const labels = (value as string[]).map(canonicalLabel);
  if (new Set(labels).size !== 3) {
    return false;
  }

  const direct =
    labels.includes("home") && labels.includes("draw") && labels.includes("away");
  const participantBased =
    (labels.includes("1") || labels.includes("participant1")) &&
    (labels.includes("x") || labels.includes("draw")) &&
    (labels.includes("2") || labels.includes("participant2"));

  return direct || participantBased;
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
  const winnerLabels = explicitWinnerLabels(rawPriceNames);

  return {
    isRecord: true,
    marketTypePresent: marketType !== undefined,
    alreadySupportedWinnerMarket,
    marketParametersEmpty: parametersEmpty,
    marketPeriodAccepted: periodAccepted,
    priceNamesArity,
    explicitWinnerLabels: winnerLabels,
    adapterEligible:
      marketType !== undefined &&
      !alreadySupportedWinnerMarket &&
      parametersEmpty &&
      periodAccepted &&
      winnerLabels
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

  return {
    ...record,
    HistoricalSourceSuperOddsType: marketType,
    SuperOddsType: "1X2"
  };
}

export function adaptHistoricalOddsPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(adaptRecord);
  }
  return adaptRecord(value);
}
