export class ApiError extends Error {
  constructor(
    message: string,
    public status = 500,
    public retryAfter = 0,
    public requestId?: string,
  ) {
    super(message);
  }
}
// Presentation only; service diagnostics and response codes stay unchanged.
export function userFacingMessage(message: string): string {
  if (/\b(?:auth0|oauth|jwt|id token)\b/i.test(message))
    return "We couldn't verify your sign-in. Please sign in again.";
  if (
    /\b(?:supabase|firebase|firestore|postgres(?:ql)?|sqlite|database|RLS)\b|storage unavailable/i.test(
      message,
    )
  )
    return "Unable to load your information. Please try again.";
  if (/\bsandbox\b/i.test(message))
    return /order not found/i.test(message)
      ? "This test payment could not be found for your account."
      : "The test payment couldn't be completed. Check its status before trying again.";
  if (
    /TWELVE_DATA_API_KEY|MARKET_DATA_PROVIDER|server-side.*(?:key|credential)|provider.*(?:key|configuration)|Twelve Data.*(?:credential|entitlement|configurat|credit)|minute.*credits|daily.*credits/i.test(
      message,
    )
  )
    return "Live currency rates are currently unavailable. No sample rates have been substituted.";
  return message;
}
export function errorStatus(error: unknown) {
  return error instanceof ApiError ? error.status : 500;
}
export const errorCopy: Record<number, { title: string; message: string }> = {
  401: {
    title: "Sign in to continue",
    message:
      "Your session is missing or has expired. Sign in again to open your wallet.",
  },
  403: {
    title: "Access denied",
    message: "Your account does not have permission to open this resource.",
  },
  404: {
    title: "Page not found",
    message: "This address does not point to an available page.",
  },
  429: {
    title: "Too many requests",
    message: "Please give the service a moment before trying again.",
  },
  500: {
    title: "Something went wrong",
    message: "We could not complete this request. You can try again.",
  },
  503: {
    title: "Service temporarily unavailable",
    message: "A required service could not be reached. Please try again later.",
  },
};
