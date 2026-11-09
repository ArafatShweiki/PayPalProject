# Hackathon demonstration

Application: <https://pay-pal-project.vercel.app>. Source: <https://github.com/ArafatShweiki/PayPalProject>.

## Prepare an isolated demonstration

Use an authorized Preview deployment and separate Supabase test project with all [13 migrations](../supabase/README.md). Configure its exact origin, Auth0 callbacks/role Action, provider credentials and [Sandbox settings](SETUP.md). Prepare two distinct authorized application accounts and a Sandbox Business merchant plus Personal payer. PayPal login and Checkout are separate integrations. Keep passwords, tokens and `.env` files offscreen.

Do not seed/backdate production records or run financial demonstrations against the production deployment. A new account correctly starts at zero and may show insufficient forecast history. If provider access is incomplete, show its actual failure/fallback and label local fixture evidence accurately.

## Suggested journey

1. Sign in, complete onboarding and explain the test-money boundary. Home shows actual balances and optional first-use guidance.
2. In isolated Preview, open Add Funds and approve a supported Sandbox payment. Only the canonical completed capture adds funds. Show the reference, one credit and persistence after refresh. Funding creates no round-up.
3. Create a personal USD goal, explicitly select it for Smart Savings and activate saving. Inspect the current increment and preserved cap before choosing a purchase. With a $1 increment and sufficient cap, a $16.40 purchase saves $0.60; available funds must cover both.
4. Review and confirm the simulated purchase. Show the recorded goal allocation and transaction detail. For cross-currency savings, use a fresh recorded quote; never invent the conversion rate.
5. Open Savings Coach. Explain stepped history, the separate dashed hypothetical comparison and constant-pace uncertainty. A real estimate needs at least fourteen days and three positive contributions across two UTC dates. Historical reassignments do not manufacture saving pace; use a clearly hypothetical comparison when history is insufficient.
6. Choose Explain with Gemini if provider access works, or demonstrate deterministic fallback. Reports generate calculated weekly/calendar-month totals. A suggested rule requires review, Cancel/Confirm and current state; AI never changes settings automatically.
7. Create a Savings Circle and manually share its direct invitation URL. Open it using the second account/browser profile. Preview does not join; explicitly choose Join Circle. Existing members see Open Circle. No invitation email is sent.
8. Each funded test account contributes after reviewing source/destination/quote. Show exact shares, member progress, timeline and only milestones genuinely crossed.
9. The owner proposes an internal transfer or return. Explain immutable terms, fixed contributor snapshot, fee, expiry and locked funds. Show one contributor's explicit confirmation and the remaining pending vote. Confirm the second contributor, then execute once. Repeating the operation must not transfer twice.
10. Review activity, Reports, rates/alerts and Settings. Home net spending records refunds on their actual dates, so a refund-only month may be negative. Savings totals include only the current user's Circle share.

A short presentation can spend one minute on sign-in/funding/round-up, one on coach/reports, one on two-account invitation/shares and one on unanimous execution/limits. Keep the second authorized account ready before presenting.

## Recovery and honest limitations

| Situation                              | Demonstrate                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Sandbox payer login fails              | Use a Developer Dashboard Sandbox Personal account, not live PayPal credentials.                                       |
| Currency unavailable                   | Use an offered merchant-tested currency. JOD is direct-funding unsupported; internal conversion still requires review. |
| Payment uncertain/pending              | Check the original payment status/reconciliation; do not start replacement money.                                      |
| Partial refund or insufficient balance | Stop financial actions and follow operator review; do not patch balances.                                              |
| Missing/stale FX                       | Refresh observations and review a new quote or explicitly skip saving where offered.                                   |
| Completed goal or reserved Circle      | Choose an eligible destination; Circle completion never distributes money automatically.                               |
| AI/quota unavailable                   | Show calculated results/fallback and retry later.                                                                      |
| Stale recommendation                   | Refresh and generate/review a current report.                                                                          |
| Invalid/revoked/expired invite         | Ask the owner to generate a new link.                                                                                  |
| Database unavailable                   | Retain the recoverable error; unavailable balances are not zero.                                                       |

No live deposits, real merchant payments, bank accounts, pooled PayPal wallet, external payout or financial advice are provided. Provider-fixture tests and earlier unapproved order probes are not completed live authentication/payment proof. Use [TESTING.md](TESTING.md) to describe evidence and unresolved provider checks accurately.

Before submission, review the public repository/README, existing MIT license, current event's official submission checklist, required demo/video materials and portal fields. Confirm eligibility, deadline and licensing rules directly with the current event; the repository does not establish them. Commit, push and submit manually after review.
