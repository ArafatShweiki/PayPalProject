import type { Bootstrap, OnboardingStatus, State } from "../shared/types.js";
import { currencies } from "../shared/money.js";
import { initialUser } from "../shared/ledger.js";
import {
  initializeProfile,
  readWallets,
  readSavingsRules,
  type Profile,
} from "./supabase.js";
import { timed } from "./diagnostics.js";
import { ServiceError } from "./reliability.js";
import { fundingEnabled } from "./funding.js";
import { rateStaleMs } from "./rates.js";
export function onboardingStatus(profile: Profile): OnboardingStatus {
  return {
    complete: !!profile.onboarding_completed_at,
    fullName: profile.full_name || "",
    email: profile.email || "",
    emailVerified: profile.email_verified,
    preferred: profile.preferred_currency,
    savings:
      profile.savings_enabled === null
        ? "unseen"
        : profile.savings_enabled
          ? "enabled"
          : "disabled",
    notifications: profile.currency_notifications,
  };
}
export async function bootstrap(
  sub: string,
  profile: Profile,
): Promise<Bootstrap> {
  const onboarding = onboardingStatus(profile);
  if (!onboarding.complete) return { onboarding };
  return timed("wallet_essential", async () => {
    const [first, rules] = await Promise.all([
      readWallets(sub),
      readSavingsRules(sub),
    ]);
    let wallets = first;
    if (currencies.some((c) => !wallets.some((w) => w.currency === c))) {
      await initializeProfile(sub);
      wallets = await readWallets(sub);
    }
    if (
      wallets.length !== 3 ||
      currencies.some(
        (c) => wallets.filter((w) => w.currency === c).length !== 1,
      )
    )
      throw new ServiceError(
        "Your wallet information is temporarily unavailable. Please retry.",
        503,
      );
    const data = initialUser();
    data.auth0Sub = sub;
    Object.assign(data.preferences, profile.wallet_preferences, {
      name: onboarding.fullName,
      preferred: onboarding.preferred,
      savings: onboarding.savings,
      notifications: onboarding.notifications,
    });
    for (const rule of rules) {
      const c = rule.currency as keyof typeof data.preferences.increments;
      data.preferences.increments[c] = Number(rule.increment_minor);
      data.preferences.caps[c] = Number(rule.cap_minor);
      data.savingsRuleEnabled ??= {};
      data.savingsRuleEnabled[c] = rule.enabled;
    }
    const balances = {} as State["balances"],
      savingsBalances = {} as State["savingsBalances"];
    for (const wallet of wallets) {
      const c = wallet.currency as keyof typeof balances;
      const available = Number(wallet.available_minor),
        savings = Number(wallet.savings_minor);
      if (
        !currencies.includes(c) ||
        ![available, savings].every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        throw new ServiceError(
          "Your wallet information is temporarily unavailable. Please retry.",
          503,
        );
      balances[c] = available;
      savingsBalances[c] = savings;
    }
    data.profile = {
      fullName: onboarding.fullName,
      email: onboarding.email,
      emailVerified: onboarding.emailVerified,
      completedAt: profile.onboarding_completed_at!,
    };
    return {
      onboarding,
      state: {
        ...data,
        balances,
        savingsBalances,
        snapshots: [],
        authMode: "auth0",
        progressive: true,
        rateStaleMs: rateStaleMs(),
        capabilities: {
          firebase: false,
          paypal: fundingEnabled(),
          gemini: !!process.env.GEMINI_API_KEY,
        },
      },
    };
  });
}
