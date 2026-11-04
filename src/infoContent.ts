export type InfoPage = {
  title: string;
  intro: string;
  sections: { heading: string; text: string }[];
};
export const infoPages: Record<string, InfoPage> = {
  "/about": {
    title: "About Dream Piggy Bank",
    intro: "Small steps toward the things you are saving for.",
    sections: [
      {
        heading: "A clearer view of saving",
        text: "Dream Piggy Bank is a development-stage, multi-currency wallet and savings prototype. It brings simulated ILS, USD and JOD balances, purchase round-ups, savings goals and indicative currency observations into one workspace. It is built for demonstration and further development, not as a deposit-taking service.",
      },
      {
        heading: "How small change becomes progress",
        text: "When Smart Savings is enabled, a simulated purchase rounds up to the next configured currency increment, subject to a savings cap. The difference is allocated to savings and, when selected, a goal in the same currency. Exact multiples save zero. Savings remain separate from available funds.",
      },
      {
        heading: "Information with context",
        text: "Stored observations from the configured PMA or Twelve Data provider help explain currency movements; retrieval times and historical coverage are shown. Calculated reports describe recorded spending. Optional AI explanations describe calculated facts; calculated summaries remain available without AI. AI does not make financial decisions or move funds.",
      },
      {
        heading: "A prototype with clear boundaries",
        text: "Wallet balances come from verified PayPal test payments and internal test-wallet activity. They are not real deposits or withdrawable funds. Signing in is required and account records are stored securely. Currency conversions use recorded market observations. Dream Piggy Bank is not operated by or endorsed by PayPal and does not claim a banking license or regulatory approval.",
      },
    ],
  },
  "/privacy-policy": {
    title: "Privacy Policy",
    intro:
      "What the application processes, how it is used, and what still needs owner review.",
    sections: [
      {
        heading: "Account and profile information",
        text: "Auth0 handles email and PayPal test-account sign-in. With your permission, it can provide your name, email and verification status so the app can keep accounts separate. The app does not collect your PayPal password. Your profile stores your name, contact email, verification status, currency and preferences.",
      },
      {
        heading: "Wallet and savings records",
        text: "Your account may store simulated transactions, savings goals, rules, alerts, reports and PayPal test-payment records. Supabase also stores circle memberships, contributions, invitation hashes and approval votes. Joining a circle shares your displayed name, circle contribution totals and circle activity with its members; it does not share your private wallet or personal transactions. Invitation previews show only the shared goal details. Shared rate caches and usage counters may use separate server storage. Market-data requests send currency symbols, not wallet balances or identity. Storage location and retention depend on the deployment.",
      },
      {
        heading: "AI report inputs and caching",
        text: "When AI explanations are available, Google Gemini receives calculated financial summaries, category totals, goal amounts without names, rates and comparison facts. These requests exclude account names, email addresses and merchant descriptions. Amounts may still be sensitive. Explanations can be reused for up to 15 minutes when inputs have not changed; stopping reuse does not guarantee immediate deletion.",
      },
      {
        heading: "Requests and service providers",
        text: "Auth0 provides sign-in; Supabase and Firestore may store account records; Google Gemini provides optional AI explanations; PMA or Twelve Data supplies market observations; PayPal supports test sign-in and test payments. Each participates only in the features in use. Hosting providers may process request information. Limited error references and anonymous or account-linked usage counters help diagnose problems and prevent excessive requests. Credentials and full private records are not intentionally included in these diagnostic events.",
      },
      {
        heading: "Cookies and browser storage",
        text: "Sign-in uses necessary browser storage and cookies. Recently loaded account information is kept temporarily in memory and cleared on account changes or sign-out. The app does not install optional analytics or advertising scripts. See the Cookie Policy for details.",
      },
      {
        heading: "Security, access and correction",
        text: "The app checks sign-in and limits access to the current account. It checks changes before saving and avoids ordinary browser caching of private responses. These measures do not guarantee security or imply certification. Review records and edit supported preferences in Settings. Manage sign-in details through your sign-in account.",
      },
      {
        heading: "Retention, deletion and contact",
        text: "Self-service account deletion and a complete automatic retention schedule are not yet available. Saved reports have a limited archive; underlying account records remain stored. Before public launch, the owner must publish an operator identity, privacy contact and process for access, retention and deletion requests. No support channel is currently available; see Contact.",
      },
      {
        heading: "Policy updates",
        text: "This page describes the repository implementation reviewed on 29 October 2026. Material changes to data flows, optional tracking or providers require a new review and updated information before release. It is not a claim that every deployment has been audited.",
      },
    ],
  },
  "/terms-of-use": {
    title: "Terms of Use",
    intro:
      "Conditions and practical limits of this development-stage application.",
    sections: [
      {
        heading: "Using the prototype",
        text: "Use Dream Piggy Bank lawfully and with an understanding that it is a prototype. Keep sign-in details private, use only your own account and never access another person's records without permission. Avoid entering sensitive real-world financial information just to test a simulation.",
      },
      {
        heading: "Simulated funds and test payments",
        text: "Wallet balances, purchases, refunds, round-ups and currency exchanges are simulated. They are not deposits or real funds held by PayPal. PayPal test payments credit test wallet balances only after server verification. Real payments and withdrawals are not available.",
      },
      {
        heading: "Information and availability",
        text: "AI explanations may be inaccurate. Savings recommendations replay recorded purchases under assumptions and are not guarantees. PMA midpoints are indicative observations, not promised execution prices; provider fees and spreads are unknown. Services may be unavailable, delayed, rate-limited or changed during development. Read the Financial Information Disclaimer.",
      },
      {
        heading: "Acceptable behavior and access",
        text: "Do not bypass sign-in, account-access checks or usage limits. Do not submit unlawful content, manipulate records or interfere with other users. Unauthorized or excessive requests can be rejected. An account-suspension appeal process is not currently available.",
      },
      {
        heading: "Software and third-party rights",
        text: "Use of the software is subject to its applicable license and third-party rights. Provider names identify services used by the app and do not imply endorsement or transfer trademark rights. Do not represent this prototype as a licensed bank or a PayPal-operated service.",
      },
      {
        heading: "Changes and owner review",
        text: "Features and these notices may change as development continues. These terms describe current functionality and do not select a governing jurisdiction, invent a contracting entity or remove rights that may apply by law. Operator identity, eligibility requirements, support and any enforceable production contract terms require owner and legal review before public launch.",
      },
    ],
  },
  "/acceptable-use": {
    title: "Acceptable Use Policy",
    intro: "Use the service responsibly and respect other users' accounts.",
    sections: [
      {
        heading: "Protect account boundaries",
        text: "Do not attempt unauthorized access, use another person's credentials, forge identity headers or tokens, enumerate private records, or access an account without permission.",
      },
      {
        heading: "Respect service limits",
        text: "Do not send spam, overwhelm the app, exhaust AI or currency-data allowances, or bypass usage limits. Excessive requests may require a waiting period before you can try again.",
      },
      {
        heading: "Keep records and demonstrations honest",
        text: "Do not manipulate transaction records, exploit duplicate requests, commit fraud, use stolen credentials or present simulated balances as real funds. PayPal features must be used only with authorized test accounts.",
      },
      {
        heading: "Lawful use and reporting",
        text: "Do not use the application unlawfully, introduce malicious content or circumvent security controls. If you discover a security concern, stop testing against other users' data and use the owner's published support channel when one becomes available. Do not send credentials or private financial information through public channels.",
      },
    ],
  },
  "/cookie-policy": {
    title: "Cookie Policy",
    intro: "Necessary sign-in and account storage.",
    sections: [
      {
        heading: "Sign-in storage",
        text: "Auth0 uses necessary browser storage and cookies to keep you signed in and renew your session. Stored sign-in information may persist after closing the browser until it expires or you sign out. Cookie names and retention depend on the sign-in service settings. Browser storage is separate from cookies.",
      },
      {
        heading: "In-memory data and legacy cookies",
        text: "Recently loaded account information is held temporarily in memory and cleared when accounts change or you sign out. The app does not create a separate Supabase sign-in session in your browser; account access uses the existing Auth0 sign-in. An unused older session cookie is removed on sign-out.",
      },
      {
        heading: "Optional technologies",
        text: "No app-installed analytics, advertising or marketing scripts were found in this repository. There are no optional tracking categories to accept or reject, so there is no tracking-consent banner or consent record. This does not assert that every identity provider or deployment-level script has been audited. Optional tracking must be reviewed and, where required, blocked until consent before it is added.",
      },
      {
        heading: "Manage storage",
        text: "Use Sign out to end your account session to end your account session. Browser site-data controls can clear stored data and cookies, which may require signing in again. Storage preferences are in Settings. The app cannot clear other services' cookies.",
      },
    ],
  },
  "/disclaimer": {
    title: "Financial Information Disclaimer",
    intro:
      "Understand the limits behind every balance, observation and recommendation.",
    sections: [
      {
        heading: "Simulation and test payments",
        text: "Wallet operations do not move real funds. Simulated balances are not deposits, safeguarded balances or real funds held by PayPal. Verified PayPal test payments can credit only the test wallet; they never move real customer funds.",
      },
      {
        heading: "AI and savings estimates",
        text: "AI output is informational, may omit context and can be inaccurate. It does not provide individualized regulated financial advice. Savings projections are estimates from recorded purchases and assumptions such as sufficient available funds. They do not guarantee results or predict future spending.",
      },
      {
        heading: "Exchange-rate information",
        text: "PMA observations are indicative, may be delayed or unavailable, and have retrieval timestamps rather than known publication timestamps. Published midpoints are not guaranteed execution rates. Real conversions would depend on the provider, spreads, fees, timing and other applicable costs. The prototype does not claim to offer live foreign-exchange execution.",
      },
      {
        heading: "Your review remains important",
        text: "Review recorded amounts and selected rules before confirming a simulated operation. When a service fails, check its status and timestamps. These limitations do not replace correct calculations, authorization checks or secure handling of data.",
      },
    ],
  },
  "/contact": {
    title: "Contact and Support",
    intro: "Support availability is stated plainly.",
    sections: [
      {
        heading: "No support channel configured",
        text: "A support email, phone number and contact form are not yet available. No response time is promised. The owner must provide verified support and privacy contacts before public launch.",
      },
      {
        heading: "Useful next steps",
        text: "Read the Help Center for sign-in, savings and currency troubleshooting. Keep an error reference if one is shown. Never share passwords, sign-in tokens, payment credentials or private transaction records through a public or unverified channel.",
      },
    ],
  },
};
