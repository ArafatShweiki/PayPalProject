# UI and UX review

Review date: 2026-11-06. Screenshots are synthetic local browser fixtures; Circle screens additionally use the real SQL functions in isolated PGlite. They are not screenshots of customer accounts or proof of live provider success.

## Screens inspected

Home, populated and insufficient-history Savings Coach, hypothetical comparison, invalid scenario, completed goal/long name, optional first-use guide, Circle contributor shares, chronological activity, pending and completed voting, Circle approval dialog, rule approval dialog, and PayPal funding dialog were rendered with Chromium. The existing suite also covers Settings, Reports, Help, login, onboarding and direct invitation layouts.

The coach, Home and Circle evidence includes 375, 768, 1024 and 1440 pixel widths. Existing application tests additionally exercise intermediate widths (390/820), short sidebar heights and mobile reduced motion. No new screen failed its horizontal-overflow assertion. Browser zoom and a full assistive-technology audit were not separately performed.

## Findings and fixes

| Finding | Change |
| --- | --- |
| No goal-focused outlook | Added a compact Home coach and detailed goal analysis, with one goal selected at a time. |
| Historical balance could imply continuous saving | Used stepped historical balances; projected savings use a dashed line with a distinct legend. |
| SVG date labels shrank too far on narrow screens | Moved date labels into readable HTML below the plot. |
| Existing goal card and coach screenshot disagreed | Corrected the test fixture to supply consistent recorded allocations to both projections; production coach uses authoritative SQL balances. |
| Adding the coach left half of the desktop bottom row empty | Goal progress and the alert/insight stack each span half the grid. |
| Sidebar appeared mid-transition in an early mobile capture | Captured at the top of the page under reduced motion; the final guide screenshot shows the closed mobile sidebar. |
| Purchases/refunds were not consistently explained | Labeled net spending and explained negative totals; preserved signed chart bars and purchase/refund breakdowns. |
| Financial approval looked like an immediate vote | Added native confirmation dialogs showing terms, Cancel and explicit Confirm. |
| Circle activity was split into nonchronological blocks | Added a paginated unified event timeline with timestamps and member attribution. |
| Creation payload amounts use a different representation than ledger amounts | Restricted timeline money formatting to signed Circle subledger events; unrelated event metadata is not interpreted as money. |
| Member shares relied on separate progress bars | Added a restrained stacked bar, matching text legend, percentages and recent contribution history. |
| First-use guidance was fragmented | Added an optional compact checklist, persisted dismissal and Help resume. |
| Saving a guide step canceled concurrent navigation reads | Isolated guide/analysis requests from financial cache invalidation; financial writes retain invalidation. |
| Sandbox account confusion | Added payer-account guidance and clear test-money, verification and interrupted-checkout explanations. |

## Design decisions

Preserved existing navy type/primary surfaces, white cards, light blue-gray page canvas, teal/green accents, Lucide icons and sidebar architecture. New tokens define ink, muted text, border, surface, accent, radius and timing without forcing a repository-wide restyle. Financial values use tabular numerals. The coach uses section boundaries and text hierarchy instead of chat bubbles, decorative charts or promotional AI content. No template, stock illustration, gradient treatment or new dependency was introduced.

## Accessibility and interaction evidence

- Native dialog semantics and modal focus are reused. The browser journey verifies focus is inside the rule confirmation, Cancel closes it, and an explicit second action submits the change. Circle financial approval also requires explicit confirmation.
- Goal and scenario inputs have visible labels; invalid scenarios use `aria-invalid` and an alert. Errors preserve the comparison value.
- Forecast charts have an accessible image description and a solid/dashed/dotted explanation. Money and dates are also rendered in text. Spending bars expose exact date/currency/amount labels and keyboard tooltips.
- Member names, exact amounts and percentages accompany the contribution bar, so color is supplementary. Timeline events use semantic list items and machine-readable times.
- Loading/error/empty states do not replace failed financial reads with zero balances. Retry actions recover coach and Circle timeline reads.
- Existing visible focus styling is retained. New motion honors reduced-motion preferences. Core controls remain available with the mobile sidebar closed.

This is practical accessibility verification, not a claim of full WCAG 2.2 AA conformance. A screen-reader audit, full contrast inventory, zoom audit and cross-browser/mobile-device testing remain release work.

## Preserved screenshot evidence

- [Coach desktop](enhancement-evidence/enhancement-coach-1440.png), [tablet](enhancement-evidence/enhancement-coach-768.png), [mobile](enhancement-evidence/enhancement-coach-375.png), [1024 px](enhancement-evidence/enhancement-coach-1024.png).
- [Home desktop](enhancement-evidence/Home-1440.png), [Home mobile](enhancement-evidence/Home-375.png).
- [Circle desktop](enhancement-evidence/circles-1440.png), [Circle mobile](enhancement-evidence/circles-375.png), [pending approvals](enhancement-evidence/enhancement-circle-pending.png).
- [Circle approval](enhancement-evidence/enhancement-circle-confirmation.png), [rule confirmation](enhancement-evidence/enhancement-rule-confirmation.png).
- [Optional guide](enhancement-evidence/enhancement-guide-375.png), [validation](enhancement-evidence/enhancement-coach-validation.png), [completed long-name goal](enhancement-evidence/enhancement-completed-375.png).
- [Funding mobile](enhancement-evidence/funding-390.png), [funding desktop](enhancement-evidence/funding-1440.png).

The full Smart Savings page remains long because it preserves destination setup, goal management, reports and history. The new coach is a detailed section rather than a separate chatbot page. Existing small-text styles elsewhere have not been claimed fully remediated. Some fast Circle screenshots include a normal transient success toast; it expires under the existing five-second behavior.
