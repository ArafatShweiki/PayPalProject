import type { Currency } from "./money";
export type CircleInvitation = {
  name: string;
  description: string;
  currency: Currency;
  target: string;
  alreadyMember?: boolean;
  circleId?: string | null;
};
export type SavingsDestination = {
  kind: "goal" | "circle";
  id: string;
  currency: Currency;
};
export type SavingsOption = SavingsDestination & {
  name: string;
  target: string;
  saved: string;
};
export type SavingsOptions = {
  destination: SavingsDestination | null;
  options: SavingsOption[];
  historical: Record<Currency, string>;
  reconciliationRequired: boolean;
};
export type SavingsQuote = {
  id: string;
  source_currency: Currency;
  source_minor: number;
  target_currency: Currency;
  target_minor: number;
  rate_units: number;
  source: string;
  observed_at: string;
  expires_at: string;
  fee_minor: number;
  destination_kind: "goal" | "circle";
  destination_id: string;
};
export type Circle = {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  target: string;
  balance: string;
  owner: boolean;
  archived: boolean;
  reached: boolean;
  icon?: string;
  targetDate?: string;
};
export type CircleMember = {
  id: string;
  name: string;
  share: string;
  active: boolean;
  you: boolean;
  owner: boolean;
};
export type CircleProposal = {
  id: string;
  kind: "withdraw" | "target" | "return_all" | "return_member" | "owner";
  amount: string;
  currency: Currency;
  fee: string;
  reason: string;
  destination: string | null;
  expiresAt: string;
  remaining: string;
  status: string;
  error?: string;
  votes: {
    memberId: string;
    decision: "Approve" | "Reject" | null;
    share: string;
  }[];
};
export type CircleDetail = Circle & {
  members: CircleMember[];
  entries: {
    id: string;
    memberId: string;
    amount: string;
    kind: string;
    at: string;
  }[];
  activity: {
    event: string;
    memberId: string;
    at: string;
    details: Record<string, unknown>;
  }[];
  proposals: CircleProposal[];
};
