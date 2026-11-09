import { Router } from "express";
import { z } from "zod";
import { currencies } from "../shared/money.js";
import type { OnboardingStatus, UserData } from "../shared/types.js";
import { userRead, userUpdate } from "./store.js";
import { auth0UserInfo } from "./auth0.js";
import { supabaseEnabled, readProfile, completeProfile } from "./supabase.js";

export const onboardingRouter = Router();
const input = z
  .object({
    fullName: z.string().trim().min(1).max(60),
    email: z.string().trim().email().max(254),
    preferred: z.enum(currencies),
    savings: z.enum(["enabled", "disabled"]),
    notifications: z.boolean().optional().default(false),
  })
  .strict();
function status(data: UserData): OnboardingStatus {
  return {
    complete: !!data.profile?.completedAt,
    fullName: data.profile?.fullName || "",
    email: data.profile?.email || "",
    emailVerified: data.profile?.emailVerified || false,
    preferred: data.preferences.preferred,
    savings: data.preferences.savings,
    notifications: data.profile ? data.preferences.notifications : false,
  };
}
onboardingRouter.use((_req, res, next) => {
  if (res.locals.authMode !== "auth0") {
    res
      .status(401)
      .json({ error: "Sign in with Auth0 to set up your profile." });
    return;
  }
  next();
});
onboardingRouter.get("/", async (_req, res) => {
  if (supabaseEnabled()) {
    const profile = res.locals.profile ?? await readProfile(res.locals.sub);
    const result: OnboardingStatus = {
      complete: !!profile?.onboarding_completed_at,
      fullName: profile?.full_name || "",
      email: profile?.email || "",
      emailVerified: profile?.email_verified || false,
      preferred: profile?.preferred_currency || "ILS",
      savings:
        profile?.savings_enabled === null
          ? "unseen"
          : profile?.savings_enabled
            ? "enabled"
            : "disabled",
      notifications: profile?.currency_notifications || false,
    };
    if (!result.complete) {
      const identity = await auth0UserInfo(res.locals.idToken, res.locals.sub);
      result.fullName ||= identity.name;
      result.email ||= identity.email;
      result.emailVerified =
        identity.emailVerified && result.email === identity.email;
    }
    res.json(result);
    return;
  }
  const data = await userRead(res.locals.uid);
  const result = status(data);
  if (!result.complete) {
    const identity = await auth0UserInfo(res.locals.idToken, res.locals.sub);
    result.fullName = identity.name;
    result.email = identity.email;
    result.emailVerified = identity.emailVerified;
  }
  res.json(result);
});
onboardingRouter.put("/", async (req, res) => {
  const body = input.parse(req.body);
  if (supabaseEnabled()) {
    const identity = await auth0UserInfo(res.locals.idToken, res.locals.sub);
    const profile = await completeProfile({
      sub: res.locals.sub,
      name: body.fullName,
      email: body.email,
      emailVerified: identity.emailVerified && body.email === identity.email,
      preferred: body.preferred,
      savings: body.savings === "enabled",
      notifications: body.notifications,
    });
    res.json({
      complete: !!profile.onboarding_completed_at,
      fullName: profile.full_name || "",
      email: profile.email || "",
      emailVerified: profile.email_verified,
      preferred: profile.preferred_currency,
      savings: profile.savings_enabled ? "enabled" : "disabled",
      notifications: profile.currency_notifications,
    } satisfies OnboardingStatus);
    return;
  }
  const existing = await userRead(res.locals.uid);
  if (existing.profile?.completedAt) {
    res.json(status(existing));
    return;
  }
  const identity = await auth0UserInfo(res.locals.idToken, res.locals.sub);
  // Profile, preferences and completion commit in a single local SQLite transaction.
  const saved = await userUpdate(res.locals.uid, (data) => {
    // Concurrent submissions or retries cannot reactivate or overwrite initial choices.
    if (!data.profile?.completedAt) {
      data.profile = {
        fullName: body.fullName,
        email: body.email,
        emailVerified: identity.emailVerified && body.email === identity.email,
        completedAt: new Date().toISOString(),
      };
      Object.assign(data.preferences, {
        name: body.fullName,
        preferred: body.preferred,
        savings: body.savings,
        notifications: body.notifications,
      });
    }
    return status(data);
  });
  res.json(saved);
});
