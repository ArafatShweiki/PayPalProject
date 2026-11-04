# PayPal and email login: feature guide

Reviewed: November 4, 2026. See [the application test report](FULL_APPLICATION_TEST_REPORT.md) for executed checks and remaining provider limitations.

This guide describes the features implemented in **Dream Piggy Bank**, based on the current project source. It does not describe everything available on PayPal's own website. “Email login” means the application's Auth0 email-and-password account, not passwordless email or a magic link.

## The main difference

**PayPal login and email login provide the same application features after successful authentication and onboarding.** Neither method unlocks a premium wallet or additional financial permissions.

There are two separate PayPal integrations:

- **Continue with PayPal** identifies you through the Auth0 `paypal-sandbox` connection. It requires a PayPal test account.
- **Add Funds** uses PayPal Sandbox Checkout to credit your internal test wallet after verified payment approval and capture. It works for users signed in through either method.

Signing in with PayPal does not add money, import your PayPal balance, or automatically authorize a payment. Signing in with email does not prevent you from using PayPal Checkout.

All balances and financial operations in this application are for testing. They are not bank deposits or withdrawable real money.

## 1. Account and login comparison

| Feature | PayPal login | Email login | Conditions or limits |
| --- | --- | --- | --- |
| Sign in to Dream Piggy Bank | Yes | Yes | Auth0 and the selected connection must be configured and available. |
| Use a regular, live PayPal account to sign in | No | Not required | The application's PayPal sign-in button routes to Sandbox only. |
| Register an email-and-password account | Use the separate email option | Yes | Choose Create an account, then Continue with email and finish Auth0 registration. |
| Enter the wallet on first sign-in | Yes, after onboarding | Yes, after onboarding | Confirm name, contact email, preferred currency, savings choice and notification preference. New accounts start with zero balances. |
| Request an application password reset | No, for the PayPal identity | Yes | Forgot password requests a reset for an existing Auth0 database account. It cannot reset a PayPal password. |
| Reset password from account settings | Not shown for a PayPal identity | Yes | The control is shown for database identities whose subject starts with `auth0\|`. |
| Change the application's display name and preferences | Yes | Yes | These changes do not change provider credentials. |
| Update contact email through onboarding/profile flow | Yes | Yes | This does not change the login email or independently verify the new address. |
| View provider identity and email verification status | Yes | Yes | A provider may not share an email or verification status. |
| Sign out of the app | Yes | Yes | Private client caches are cleared on logout/account changes. Do not assume this also signs out of every provider website. |
| Automatically merge PayPal and email accounts with the same email | No | No | Ownership follows the verified provider identity, not the email address. There is no in-app account-linking or balance-merge flow. |
| Sign in with Google | No | No | Google login is disabled. |
| Use an anonymous/demo wallet or bypass authentication | No | No | Public informational pages remain available. |
| Sign in using only an emailed magic link or one-time email code | No implemented flow | No implemented flow | The email option redirects to the configured Auth0 database connection. |

**Account continuity:** If PayPal and email login produce different provider subjects, they open separate application accounts even when their email addresses match. Using email after a PayPal sign-in failure does not automatically recover that PayPal identity's wallet.

## 2. Wallet, payments and activity

In this table, “Both” means either successful login method. Provider availability, configured limits, onboarding, account ownership and sufficient funds still apply.

| Feature | Available to | What can be done / what cannot be done |
| --- | --- | --- |
| Home dashboard | Both | View account totals, spending information, savings progress and recent activity. Currency-combined displays depend on available stored rates. |
| Multi-currency wallets | Both | View separate available and savings balances in USD, ILS and JOD. Changing the preferred display currency does not convert funds. |
| PayPal test funding | Both | Open Add Funds on Home or My Wallet, choose an offered currency/amount and approve Sandbox Checkout. Email users also need access to a suitable PayPal test payer account for this step. |
| Direct USD funding | Both, when configured | Supported by the funding implementation; USD is the default configured currency. |
| Direct ILS funding | Both, when enabled | Supported in code, but must be enabled and accepted by the receiving Sandbox merchant. The dialog's offered currencies are authoritative for that environment. |
| Direct JOD funding | Neither | Not supported by the application's PayPal funding implementation. Obtain internal JOD test funds through a supported conversion instead. |
| Funding amount limits | Both | Minimum 1.00 in an offered currency. Default maximum 5,000.00 per order, configurable within the implementation's hard limit. Check the dialog for actual limits. |
| Interrupted payment recovery | Both | Check the status of an owned payment attempt. Verified completed captures can be recovered without a second wallet credit. |
| Cancel a pending funding attempt | Both | Cancellation does not credit the wallet and is not a refund. A provider capture that already completed must be reconciled. |
| Funding history | Both | Inspect attempt status, amount, currency, PayPal source and reference in activity. Pending, failed and canceled attempts do not add funds. |
| Simulated purchases | Both | Record a purchase using available internal funds. This is not a payment to a real merchant. If savings apply, funds must cover the purchase plus its round-up. |
| Simulated purchase refunds | Both | Reverse an eligible owned purchase under the savings rules described below. This is separate from refunding a PayPal funding capture. |
| Activity filters and details | Both | Filter by currency, category, date and savings; load older records and inspect transaction details and available ledger postings. |
| PayPal funding refund detection | Both | A status check can reconcile a provider-verified full refund once. Partial refunds or insufficient funds require operator review and can block private mutations. |
| Initiate a PayPal refund in the app | Neither | No provider-refund initiation flow is implemented. |
| Automatically sync PayPal transactions or balance | Neither | Login and Checkout do not import the rest of the PayPal account. |
| Bank transfers, card funding or cash deposits | Neither | No independent bank/card/cash funding flow is implemented. The app exposes PayPal Sandbox payment eligibility. |
| Real payments, real-money withdrawals or cash-out | Neither | No live payment mode, bank withdrawal or PayPal cash-out is implemented. |

Funding increases available funds only. It does not create a round-up, count as purchase spending, or count as savings income.

## 3. Personal goals and Smart Savings

| Feature | PayPal login | Email login | Conditions or limits |
| --- | --- | --- | --- |
| Create a personal savings goal | Yes | Yes | Choose a name, currency, target and optional target date. |
| Browse goals and progress | Yes | Yes | Selecting a card for viewing does not change the default destination. |
| Set or change the default savings destination | Yes | Yes | Explicitly choose an eligible personal goal or Savings Circle. Existing savings stay in their recorded destinations. |
| Enable or disable automatic round-ups | Yes | Yes | A valid goal destination is required for active saving. Enabling without one leaves setup pending. Disabling affects future purchases. |
| Set round-up increments | Yes | Yes | USD/ILS use two decimal places; JOD uses three. Exact multiples produce zero savings. Existing saved per-purchase caps still apply; cap inputs have been removed from Settings. |
| Save a purchase round-up to a different goal currency | Yes | Yes | Only the savings portion is converted, using a fresh recorded quote. No conversion proceeds using an invented or stale rate. |
| Continue a purchase without a round-up when setup fails | Yes | Yes | Requires the explicit no-round-up choice in the purchase flow. Failure must not silently deduct savings. |
| Assign historical unassigned savings | Yes | Yes | Explicitly assign an amount to an owned personal goal in the same currency. This reallocates existing savings; it creates no new money. |
| Archive a personal goal | Yes | Yes | Retains saved funds and history; it is not cash-out. |
| Save new round-ups to General Savings without a goal | No | No | Current implementation requires a goal or Circle. Historical unassigned balances are preserved. |
| Automatically move old savings after changing defaults | No | No | A default change directs future allocations only. |

Example: with an ILS 5 increment and a cap of at least ILS 1.60, an ILS 23.40 purchase saves ILS 1.60. Available funds decrease by ILS 25.00, provided all destination and quote checks succeed.

Refund behavior depends on the recorded destination. Personal-goal purchase refunds reverse the purchase and its recorded savings allocation under the transaction checks. For Circle-linked purchases, the purchase refund returns the merchant portion only; Circle contributions return through the Circle approval process. A private purchase refund cannot take another member's share.

## 4. Savings Circles

These features are implemented for **both login methods**, but require the Circle migration and working backend configuration. Permission depends on Circle membership, ownership and outstanding contributions, not the login provider.

| Feature | What can be done | Restriction |
| --- | --- | --- |
| Create a Circle | Set its details, currency and savings target. | No public Circle directory is implemented. |
| Invite members | The owner generates a direct invitation link and shares it manually. | Links expire after seven days and can be revoked/replaced. No invitation email or message is sent by the app. |
| Join a Circle | Preview a valid invitation, sign in, complete onboarding and explicitly join. Existing members see an already-in-the-circle message and Open Circle. | An invitation preview alone does not grant membership or access to private Circle details. Membership-aware links require migration `202611010001`. |
| Contribute | Use available test-wallet funds, a personal savings goal, or future Smart Savings allocations with the required review. | Must pass balance, currency/quote and Circle state checks. Contributions pause during a reserved approval request or after target completion. |
| View shared progress | Members see Circle activity, shares and votes. | This does not expose another member's private wallet or purchase history. The view shows the most recent 50 activity entries/events. |
| Withdraw/transfer Circle test funds | Owner proposes a transfer to an existing member's internal wallet. | Every member with a positive share in the request snapshot must explicitly approve. This is not an external withdrawal. |
| Return contributions, increase target or change ownership | Use the supported owner/action and approval workflows. | Outstanding funds require the applicable unanimous approval process. |
| Vote | A required contributor can approve or reject their own vote. | A rejection cancels the request; missing votes keep funds locked. One active request is allowed per Circle. |
| Complete a target | View completion and choose an approved next step. | Target completion does not trigger automatic withdrawal. |
| Leave or archive | An eligible non-contributor can leave; an empty Circle can be archived. | Outstanding shares must be resolved before leaving. Archiving requires zero balance and no active reservation. History is retained. |

Circle requests expire after seven days. Refresh the Circle view to see another member's latest vote. There is no general-purpose user-to-user PayPal transfer feature; supported Circle distributions remain internal simulated wallet operations.

## 5. Currency rates, alerts and reports

| Feature | Available to | Conditions or limits |
| --- | --- | --- |
| View currency observations | Both | View supported USD/ILS, USD/JOD and calculated JOD/ILS observations, including source, timestamp and availability. These are indicative rates. |
| View rate history | Both | Select available history windows from 1 hour through 90 days. Only stored observations appear; missing historical data is not fabricated. |
| Refresh rates | Both | Subject to server/provider availability and rate limits. |
| Preview and confirm internal conversions | Both | Review source/target currencies, amount, rate, fees and received amount, then explicitly confirm. Requires sufficient funds and a valid fresh preview. This is simulated exchange, not live FX trading. |
| Read currency insights | Both | AI/provider-dependent explanations can be unavailable. They do not execute conversions or guarantee prices. |
| Create and manage rate alerts | Both | Supported conditions include percentage movement, absolute movement and target-rate crossing. Triggers depend on recorded observations and cooldown rules. |
| Receive in-app notices | Both | Subject to notification preferences and event conditions. No email, SMS or push delivery is implemented. |
| Generate weekly financial reports | Both | Seven local calendar days ending on the selected date. Current periods stop at generation time. |
| Generate monthly financial reports | Both | Selected calendar month, using the report timezone. This is not always a rolling 30-day period. |
| Read report totals and comparisons | Both | Based on recorded owned data and refund cutoffs. Earlier-period comparisons require sufficient history. Savings totals include the user's own Circle shares rather than the entire Circle pool. |
| Read AI report explanations | Both | Requires configured/available Gemini service. Calculated summaries remain available when AI is unavailable. AI receives aggregate report facts rather than login credentials. |
| Accept or dismiss a savings recommendation | Both | Acceptance requires explicit user action and current rule/ledger checks. AI cannot change settings by itself. |
| View saved reports and download them | Both | Report archive supports JSON download. No dedicated PDF, spreadsheet or complete-account export is implemented. |
| Receive reports automatically on a schedule | Neither | Frequency is a preference used by report generation; no automatic report scheduler is implemented. |

Settings and help describe the implemented period rules: weekly reports cover seven local calendar days, and monthly reports cover the selected calendar month.

## 6. What neither login method provides

Neither PayPal nor email login enables:

- Live PayPal payments, real bank deposits, cash-out, real merchant purchases or executable FX trading.
- Automatic access to your PayPal balance, linked banks/cards, address book or transaction history.
- Direct JOD PayPal funding, payment credit before provider verification, or credit from a failed/canceled attempt.
- Automatic account linking, wallet merging, or identity changes just by editing a contact email.
- Access to another user's private wallet, or unilateral withdrawal of shared Circle funds.
- Automatic movement of money because AI suggested a rule, a rate alert triggered, or a goal completed.
- Automatic report delivery, email/SMS/push alerts, or invitation sending.
- A self-service account-deletion flow, a complete account export, or a local/offline wallet fallback when the database is unavailable.

Public help, legal and support-information pages can be read without signing in. A valid Circle invitation can expose its limited preview without granting access to the private wallet.

## 7. Availability and verification limits

“Implemented” means a feature exists in this source tree. It does not establish that a deployed environment has the necessary connections, credentials, migrations, provider acceptance or completed external tests.

- Authentication requires the existing Auth0 tenant/connections and Supabase identity setup. Private features require a verified session and completed onboarding.
- Funding requires separate Sandbox Checkout credentials and a merchant ID. The funding implementation supports a configured subset of USD and ILS; check the dialog rather than assuming both are enabled.
- The November 4 audit successfully created and retrieved unapproved USD and ILS Sandbox orders matching the configured merchant. It does **not** establish completed payer approval, capture or persisted wallet credit.
- The November 4 read-only schema check found only the new invitation status/join functions missing. Apply `202611010001_circle_invitation_membership.sql` after the earlier Circle migrations before using membership-aware invitations in that database.
- Rates, AI, amount limits, quotas, refund-review holds and provider outages can restrict a feature for either login method equally.
- The audit used isolated automated tests, read-only connected-database checks and limited provider probes. No production account/balance changes or migrations were performed. Gemini requests failed because the configured API key is invalid.

## Source references

| Area | Project references |
| --- | --- |
| Login, registration, password reset and profile display | [Auth UI](src/Auth.tsx), [identity verification](server/auth0.ts), [onboarding](server/onboarding.ts) |
| Shared private-feature authorization and wallet operations | [API routes](server/app.ts), [progressive reads](server/progressive.ts) |
| Funding and currency/amount restrictions | [Funding backend](server/funding.ts), [Sandbox provider adapter](server/paypal.ts), [funding guide](PAYPAL_FUNDING.md) |
| Goals, refunds and Circles | [Savings/Circle API](server/savings-circles.ts), [current SQL migration](supabase/migrations/202610310002_goal_savings_circles.sql), [current implementation report](SAVINGS_CIRCLES_IMPLEMENTATION.md) |
| Reports and recommendations | [Report service](server/reports.ts), [period calculations](shared/report-period.ts), [report implementation](GEMINI_REPORTS_IMPLEMENTATION.md), [JSON download](src/Settings.tsx) |
| User-facing navigation and help | [App](src/App.tsx), [help content](src/helpContent.ts), [project overview](README.md) |
