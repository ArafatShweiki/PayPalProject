# Dream Piggy Bank demonstration guide

## Prerequisites

Use an authorized isolated Preview deployment and Supabase project for financial demonstrations. Do not seed or backdate production records. Apply all migrations in filename order, including `202611060002_product_enhancements.sql`, after validating them against the isolated project.

Keep the existing configuration: Auth0 tenant/client and permitted callback/logout URLs; Supabase Third-Party Auth mapping and server secret; exact `APP_ORIGIN`; server-only PayPal Sandbox application client ID/secret/merchant ID; explicitly merchant-tested funding currencies; optional Gemini key/model and existing rate provider. No new environment variable is introduced. Keep private `.env` files out of Git and screenshots.

Prepare two separately authorized application accounts to demonstrate unanimous voting. In the PayPal Developer Dashboard prepare a Sandbox business merchant/application and a Sandbox personal payer account. Use Sandbox payer credentials at Sandbox Checkout. Ordinary live PayPal credentials cannot sign in there. The Auth0 PayPal sign-in connection is independent of Checkout funding. Do not display account passwords during a presentation.

## Main journey and expected results

1. Sign in and complete the existing profile onboarding. Home shows actual available balances and the optional checklist. Explain that wallet balances and operations are test money.
2. Open Add Funds, choose a merchant-supported currency (prefer USD where configured), enter an allowed amount and approve Sandbox Checkout. The app verifies the canonical provider capture server-side. Only a completed verified capture credits the wallet. Funding creates no round-up.
3. Create a personal USD savings goal with a sensible target. Choose it as the Smart Savings destination and activate savings. Inspect Settings to see the current increment and cap; do not assume defaults if this account was previously used.
4. Simulate a purchase with an amount that is not a multiple of that increment. Review the exact purchase, round-up and destination before completing. For example, with a $1 increment and a sufficient cap, $16.40 produces $0.60 savings. The wallet must cover both amounts.
5. Inspect the goal and purchase ledger detail. The available wallet falls by purchase plus saving, while the goal receives the verified saving. Optionally demonstrate ILS/JOD to USD round-ups when fresh FX observations are available. Use recorded quote amounts, not a manually invented rate.
6. Open Your savings outlook. A new account correctly reports insufficient history. Hypothetical weekly amounts still demonstrate the deterministic comparison without changing settings. For a real historical forecast use an existing authorized test account with at least fourteen days and three positive contributions across two dates. Never backdate hosted records for presentation. Explain the solid historical steps, dashed hypothetical line, and uncertain constant-pace assumption.
7. Select Explain with Gemini. The provider selects a permitted interpretation of computed states. If it is unavailable, show the calculated outlook and explicit fallback. Open calculated rule suggestions to generate a Report. A suggestion appears only if supported by actual purchases and recorded funds. Review current/proposed rules and cap; demonstrate Cancel, then Confirm if you intend the change. Stale settings or ledger revisions require a new report.
8. Create a Savings Circle, set its target and generate a direct invitation URL. Copy and share the URL manually; no invitation email is sent. Open it in a separate browser profile/account. The second user sees a preview and must explicitly Join Circle (or choose Not Now).
9. Fund the second authorized test wallet if needed. Each member contributes after reviewing the source, destination, fees and conversion. Show outstanding member shares, exact percentages and chronological activity. Milestone notifications appear only when a threshold is actually crossed. Do not pretend a threshold was reached if the target is still distant.
10. The owner proposes a small transfer, target increase or return of contributions. Explain the amount, destination, reason, fee, expiry and fixed contributor snapshot. Contributions pause while the request locks the Circle. The first contributor opens Approve and explicitly confirms. Show the pending voters and locked funds. The second contributor also approves; only then can the owner execute. The shared balance and member shares update atomically once. A reject or expiration prevents execution.
11. Open Reports and review the recorded spending/saving period and optional Gemini explanation. On Home, explain that monthly net spending counts refunds on their recorded dates. A negative net month means recorded refunds exceeded that month's purchases; no number is hidden or converted to positive.

## Suggested short presentation

- First minute: sign-in, test funds, goal and purchase with a visible round-up.
- Second minute: recorded goal outlook, hypothetical comparison and explicit rule review.
- Third minute: invite the second prepared account, contribution shares and one approval from each contributor.
- Final minute: execute the approved test transfer, show activity/report and state the Sandbox limitations.

Keep a second account signed in beforehand. Use only previously authorized test accounts. If provider setup is incomplete, present the relevant failure state and local test evidence as such; do not describe mocked provider success as a live payment.

## Recovery and limitations

| Situation | Recovery |
| --- | --- |
| Sandbox rejects login | Check that the payer is a Developer Dashboard Sandbox personal account, not a live PayPal account. |
| Currency unavailable | Use a configured merchant-tested funding currency. JOD is not direct PayPal funding. Do not silently switch currencies. |
| Checkout interrupted or pending | Check the existing payment status/reconciliation before starting another order. Pending, canceled and failed attempts do not credit funds. |
| Funding reversal requires review | Stop financial actions and follow the administrator review path; do not repair balances manually. |
| Missing/expired FX quote | Refresh supported observations and review a new quote, or explicitly continue without a round-up where offered. No invented conversion should be shown. |
| Goal completed/archived or Circle locked | Choose an eligible destination. Circle completion requires a unanimous next-step proposal; money is never distributed automatically. |
| AI unavailable/quota exhausted | Keep using deterministic calculations. Retry later without repeatedly generating explanations. |
| Forecast unavailable | Build genuine saving history; use the clearly hypothetical comparison meanwhile. |
| Rule suggestion stale | Refresh state, generate a new report and review again. |
| Invite invalid/revoked/expired | Ask the Circle owner to generate a new direct URL. |
| Wallet/database unavailable | Use retry and retain the error state; never portray unavailable balances as zero or seed replacement funds. |

No real-money deposit, pooled PayPal account, bank account or live payout is implemented. Operator identity and production legal notices still need owner/legal review before a public financial launch. No deployment, hosted migration or production mutation was performed by this enhancement task.
