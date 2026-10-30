export type Article = {
  title: string;
  category: string;
  steps: string[];
  link: string;
  linkText: string;
};
export const articles: Article[] = [
  {
    title: "Create an account and sign in",
    category: "Getting started",
    steps: [
      "Choose Create an account, then Continue with email. Follow the sign-in screen to finish registering.",
      "Continue with PayPal is available for PayPal test accounts only. Regular PayPal accounts cannot use this sign-in option.",
      "Finish onboarding by confirming your name, contact email, preferred currency, round-ups and notification choice. Updating the contact email does not change your provider login or verify a new address.",
    ],
    link: "/#Home",
    linkText: "Open sign-in",
  },
  {
    title: "Explore Developer Demo Mode",
    category: "Getting started",
    steps: [
      "When available, choose Explore Dream Piggy Bank (Demo Mode) to try the features without signing in.",
      "Demo balances, purchases, savings and goals remain simulated in this browser tab. Rates use real market observations when available; sample rates require explicit selection. Demo activity stays separate from your signed-in account and cannot make PayPal payments.",
      "Exit Demo Mode clears its records. Demo records never migrate to a signed-in account.",
    ],
    link: "/#Home",
    linkText: "Open Home",
  },
  {
    title: "Understand balances and transaction history",
    category: "Your wallet",
    steps: [
      "Open My Wallet to inspect separate available and savings balances in ILS, USD and JOD. All wallet transactions in this prototype are simulations, including signed-in sessions.",
      "The dashboard's combined value uses the latest stored currency midpoint. Savings are shown separately from available funds.",
      "Filter wallet activity by currency, category or date. Select an entry to inspect its amount, date, savings allocation and balanced ledger postings. Refunds reverse the original purchase and round-up.",
    ],
    link: "/#My%20Wallet",
    linkText: "Open My Wallet",
  },
  {
    title: "Preview a currency conversion",
    category: "Your wallet",
    steps: [
      "Open Currency Rates. Choose different source and target currencies and enter the amount.",
      "Preview the conversion and review the indicative rate, source and estimated received amount. Confirm explicitly to record a simulated exchange.",
      "Forex previews expire within one minute (legacy/demo previews within five minutes) and are checked again when confirmed. If a rate changes or is older than the freshness threshold, refresh and request a new preview. This is not an executable foreign-exchange quote.",
    ],
    link: "/#Currency%20Rates",
    linkText: "Open Currency Rates",
  },
  {
    title: "Activate round-ups and edit savings settings",
    category: "Smart Savings",
    steps: [
      "Activate Smart Savings on its overview, or enable automatic round-ups in Settings. Disabling round-ups affects future purchases and keeps existing savings.",
      "Each currency has its own increment and cap. The difference to the next increment is saved, limited by the cap. Exact multiples save zero. An ILS 23.40 purchase with an ILS 5 increment saves ILS 1.60; available funds decrease by ILS 25.00.",
      "USD and ILS use two decimal places; JOD uses three. Save preferences to apply rule changes. Purchases require enough available funds for both the purchase and its savings.",
    ],
    link: "/#Settings",
    linkText: "Open savings settings",
  },
  {
    title: "Create goals and track progress",
    category: "Smart Savings",
    steps: [
      "Choose New savings goal, enter a name, currency, target amount and optional date, then create it. The new goal becomes the destination for future round-ups in that currency.",
      "Drag, swipe, use Previous/Next, or focus a goal card and use Left/Right, Home or End to inspect goals. Browsing updates the details panel without changing your destination.",
      "Choose Select goal in the details panel to direct future round-ups there. Each currency has its own destination. Existing allocations stay with their original goals. Goal-name and target editing is not implemented.",
    ],
    link: "/#Smart%20Savings",
    linkText: "Open Smart Savings",
  },
  {
    title: "Read weekly and monthly savings reports",
    category: "AI savings advisor",
    steps: [
      "Choose weekly or monthly frequency in Settings, then generate a report in Reports or Smart Savings. Periods cover the preceding 7 or 30 days, with a prior period comparison only when sufficient recorded history exists.",
      "Reports use recorded purchases and exclude refunds. AI explanations are labeled when available. Calculated summaries remain available without AI; Demo Mode uses calculations only.",
      "An earlier AI explanation may be reused when its inputs have not changed. Its date is shown; totals and recommendations are recalculated for each report. Download saved reports as JSON.",
    ],
    link: "/#Reports",
    linkText: "Open Reports",
  },
  {
    title: "Accept or dismiss a suggested savings rule",
    category: "AI savings advisor",
    steps: [
      "Review the proposed increment and estimated additional savings, calculated by replaying recorded purchases with their cap. The estimate assumes sufficient funds and does not predict future purchases.",
      "Accept rule applies the suggested increment; Dismiss leaves settings unchanged. AI text cannot change your settings.",
      "If the ledger, cap or savings settings changed since the recommendation, generate a new report before accepting.",
    ],
    link: "/#Reports",
    linkText: "Review recommendations",
  },
  {
    title: "Read Forex observations and rate alerts",
    category: "Currency intelligence",
    steps: [
      "Currency Rates shows the rate source, quote time, update status and recorded movements. Updates are shared across users and checked at regular intervals. PMA observations are indicative, not guaranteed prices.",
      "USD/ILS and USD/JOD use provider quotes; JOD/ILS is a calculated indicative cross-rate. USD/JOD is pegged and can remain unchanged. Market open/closed status comes from provider flags; unknown status is not guessed from a calendar. Stale quotes cannot confirm a new simulated conversion.",
      "Select 1 hour, 24 hours, 7 days, 30 days or 90 days to view available stored observations. No historical backfill is invented. The chart states limited coverage or insufficient history. A new installation may have very little history.",
      "Create a percentage, absolute movement or target-rate alert. Target alerts trigger when a recorded rate crosses the threshold. In-app notifications respect your preference, per-observation duplicate prevention and a 24-hour cooldown. No email or push delivery is provided.",
    ],
    link: "/#Currency%20Rates",
    linkText: "Manage rate alerts",
  },
  {
    title: "Profile, privacy and sign-out",
    category: "Account and settings",
    steps: [
      "Open Settings to update your display name, preferred currency, round-up rules, report frequency and in-app notifications. Your identity provider manages your sign-in identity.",
      "Storage preferences explain the browser storage needed for sign-in and Demo Mode. The app does not install analytics or advertising trackers.",
      "Sign out ends your app session and clears recently loaded account information. On a shared device, also check your sign-in account and browser storage.",
    ],
    link: "/#Settings",
    linkText: "Open Settings",
  },
  {
    title: "Troubleshoot sign-in, missing records and failed requests",
    category: "Troubleshooting",
    steps: [
      "Try signing in again or use Forgot password for an email account. PayPal sign-in requires a test account. If that option is unavailable, continue with email.",
      "Check that you are using the correct account and mode. Demo records are separate and cleared on exit. Use wallet filters to find transactions. If a PayPal test payment has an uncertain status, check the existing payment before starting another.",
      "If rates or AI explanations are unavailable, check the last quote time or read the calculated summary. Wait for the displayed retry countdown. Keep any error reference if you need help, but never share credentials.",
    ],
    link: "/contact",
    linkText: "Support information",
  },
];
