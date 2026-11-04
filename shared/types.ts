import type { SavingsDestination, SavingsQuote } from "./circles";
import type { Currency } from "./money";
export type Balances = Record<Currency, number>;
export type Entry = {
  id: string;
  at: string;
  kind:
    | "opening"
    | "purchase"
    | "refund"
    | "conversion"
    | "funding"
    | "reversal"
    | "adjustment";
  status?: string;
  fundingSource?: string;
  reference?: string;
  currency: Currency;
  amount: number;
  saved: number;
  description: string;
  category: string;
  postings: {
    currency: Currency;
    account: "available" | "savings" | "external";
    amount: number;
  }[];
  circleId?: string;
  saving?: SavingsQuote;
  goalId?: string;
  savingsDestination?: string;
  allocationDelta?: number;
  originalId?: string;
  savingsRetained?: boolean;
  to?: Currency;
  received?: number;
  rate?: number;
  snapshotId?: string;
  quoteSource?: string;
  observedAt?: string;
  method?: string;
  simulatedFee?: number;
  simulatedSpread?: number;
};
export type Goal = {
  id: string;
  name: string;
  currency: Currency;
  target: number;
  createdAt: string;
  targetDate?: string;
  archived?: boolean;
};
export type Preferences = {
  savingsDestination?: SavingsDestination | null;
  name: string;
  preferred: Currency;
  savings: "unseen" | "enabled" | "disabled";
  increments: Balances;
  caps: Balances;
  goalIds: Partial<Record<Currency, string | null>>;
  frequency: "weekly" | "monthly";
  notifications: boolean;
};
export type Snapshot = {
  id: string;
  fetchedAt: string;
  source: string;
  publishedAt: string | null;
  market?: {
    provider: "Twelve Data";
    timeKind: "minute quote";
    legs: {
      symbol: string;
      rate: number;
      observedAt: string;
      marketOpen: boolean | null;
    }[];
  };
  ils: Balances;
  quotes: { pair: string; bid: string; ask: string }[];
};
export type Alert = {
  id: string;
  from: Currency;
  to: Currency;
  direction: "increase" | "decrease";
  mode: "percent" | "absolute" | "target";
  lastSnapshotId?: string;
  lastObserved?: number;
  threshold: number;
  enabled: boolean;
  reference: number;
  lastTriggered?: string;
  watched?: number;
};
export type Notice = {
  id: string;
  at: string;
  title: string;
  body: string;
  read: boolean;
};
export type Recommendation = {
  estimatedSavings?: number;
  recordedSavings?: number;
  id: string;
  currency: Currency;
  current: number;
  suggested: number;
  additional: number;
  status: "pending" | "accepted" | "dismissed";
  reportId: string;
  cap: number;
  ledgerRevision: string;
};
export type CurrencyInsight = {
  comparisonPeriod?: "available" | "24h" | "7d" | "30d";
  earliestAt?: string;
  monitorThresholdPercent?: number | null;
  observedAt?: string;
  explanationCache?: { generatedAt: string; cached: boolean };
  from: Currency;
  to: Currency;
  amount: number;
  rate: number;
  received: number;
  referenceRate: number | null;
  previousValue: number | null;
  difference: number | null;
  changePercent: number | null;
  minimumRate: number;
  maximumRate: number;
  observationCount: number;
  fetchedAt: string;
  referenceAt: string | null;
  sourceUrl: string;
  stale: boolean;
  source: "Gemini" | "deterministic";
  observations: string[];
};
export type Summary = {
  averageSpending?: number | null;
  previousSavings?: number | null;
  savingsChange?: number | null;
  currency: Currency;
  spending: number;
  savings: number;
  count: number;
  previousSpending: number | null;
  spendingChange?: number | null;
  spendingChangePercent?: number | null;
  categories: Record<string, number>;
};
export type Report = {
  circleSavings?: Balances;
  totalSavings?: Balances;
  savingsBalances?: Balances;
  generalSavings?: Balances;
  until?: string;
  timezone?: string;
  complete?: boolean;
  previousUntil?: string;
  status?: "complete" | "ai_unavailable" | "empty";
  aiError?: string;
  model?: string;
  promptVersion?: string;
  inputFingerprint?: string;
  aiContent?: {
    summary: string;
    spendingInsights: string[];
    savingsInsights: string[];
    recommendations: { id: string; description: string }[];
    nextSteps: string[];
  };
  explanationCache?: { generatedAt: string; cached: boolean };
  id: string;
  at: string;
  frequency: "weekly" | "monthly";
  since: string;
  summaries: Summary[];
  source: "Gemini" | "deterministic";
  observations: string[];
  goals: {
    name: string;
    currency: Currency;
    target: number;
    saved: number;
    progressPercent?: number;
  }[];
};
export type OnboardingProfile = {
  fullName: string;
  email: string;
  emailVerified: boolean;
  completedAt: string;
};
export type OnboardingStatus = {
  complete: boolean;
  fullName: string;
  email: string;
  emailVerified: boolean;
  preferred: Currency;
  savings: "unseen" | "enabled" | "disabled";
  notifications: boolean;
};
export type UserData = {
  circleEntries?: {
    currency: Currency;
    amount: number;
    at: string;
    circleId: string;
  }[];
  savingsRuleEnabled?: Partial<Record<Currency, boolean>>;
  auth0Sub?: string;
  profile?: OnboardingProfile;
  createdAt: string;
  preferences: Preferences;
  ledger: Entry[];
  goals: Goal[];
  alerts: Alert[];
  notices: Notice[];
  reports: Report[];
  recommendations: Recommendation[];
  operations: Record<string, { fingerprint: string; result: unknown }>;
};
export type State = UserData & {
  progressive?: boolean;
  reportTotal?: number;
  dashboard?: {
    circleSavings?: Balances;
    generalSavings?: Balances;
    dailySpending: { day: string; currency: Currency; amount: number }[];
    goalTotals: Record<string, number>;
  };
  loadingSections?: string[];
  marketStatus?: MarketStatus;
  rateStaleMs?: number;
  balances: Balances;
  savingsBalances: Balances;
  snapshots: Snapshot[];
  ratesError?: string;
  capabilities: { firebase: boolean; paypal: boolean; gemini: boolean };
  authMode: "auth0";
};
export type Bootstrap = { onboarding: OnboardingStatus; state?: State };
export type ActivityPage = { entries: Entry[]; nextCursor: string | null };
export type FundingOrder = {
  id: string;
  auth0_sub: string;
  request_id: string;
  fingerprint: string;
  currency: "USD" | "ILS";
  amount_minor: number | string;
  status: string;
  provider_order_id?: string;
  capture_id?: string;
  transaction_id?: string;
  approval_url?: string;
  created_at: string;
  reversal_id?: string;
};

export type MarketStatus = {
  provider: "Twelve Data" | "PMA" | "Unknown";
  configured: boolean;
  transport: "polling";
  pollMs: number;
  staleMs: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextAttemptAt?: string;
  error?: string;
  failures?: number;
  connection: "waiting" | "connected" | "unavailable";
};
export type MarketFeed = {
  snapshots: Snapshot[];
  status: MarketStatus;
  notices?: Notice[];
};
