import type { Currency } from "./money";
export type Balances = Record<Currency, number>;
export type Entry = {
  id: string;
  at: string;
  kind: "opening" | "purchase" | "refund" | "conversion";
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
  goalId?: string;
  originalId?: string;
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
};
export type Preferences = {
  name: string;
  preferred: Currency;
  savings: "unseen" | "enabled" | "disabled";
  increments: Balances;
  caps: Balances;
  goalIds: Partial<Record<Currency, string>>;
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
  explanationCache?: { generatedAt: string; cached: boolean };
  id: string;
  at: string;
  frequency: "weekly" | "monthly";
  since: string;
  summaries: Summary[];
  source: "Gemini" | "deterministic";
  observations: string[];
  goals: { name: string; currency: Currency; target: number; saved: number }[];
};
export type SandboxOrder = {
  id: string;
  requestId: string;
  status: string;
  captureId?: string;
  approvalUrl?: string;
  at: string;
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
  sandbox: SandboxOrder[];
  operations: Record<string, { fingerprint: string; result: unknown }>;
};
export type State = UserData & {
  demoMarketMode?: "live" | "sample";
  marketStatus?: MarketStatus;
  rateStaleMs?: number;
  balances: Balances;
  savingsBalances: Balances;
  snapshots: Snapshot[];
  ratesError?: string;
  capabilities: { firebase: boolean; paypal: boolean; gemini: boolean };
  authMode: "demo" | "firebase" | "auth0";
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
