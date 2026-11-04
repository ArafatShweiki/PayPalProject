export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export function databaseError(error: {
  code?: string;
  message?: string;
}): DatabaseError {
  if (error.code === "P0001") {
    const messages: Record<string, string> = {
      "Circle is archived":
        "This circle is archived. Its history remains available.",
      "Invalid proposal destination":
        "Select an active member of this circle as the destination.",
      "Invalid proposal currency": "Use the circle currency for this request.",
      "Choose a savings goal before saving":
        "Choose a savings goal before saving, or explicitly continue without a round-up.",
      "Savings destination unavailable":
        "Your savings goal is unavailable or completed. Choose another goal before saving.",
      "Savings destination changed":
        "Your savings destination changed. Review this purchase again.",
      "Savings quote expired":
        "The savings quote expired. Review the conversion again.",
      "Savings quote invalid":
        "This savings conversion could not be verified. Review it again.",
      "Circle access denied": "This circle is unavailable to your account.",
      "Only the circle owner may do this":
        "Only the circle owner can initiate this action.",
      "Circle funds are locked for a vote":
        "Circle funds are locked while a request awaits approval, execution, or cancellation.",
      "Invitation unavailable":
        "This invitation is invalid, revoked, or expired.",
      "Unanimous approval is required":
        "Every contributor must explicitly approve before this request can execute.",
      "Voting is closed": "Voting is closed for this request.",
      "You cannot vote on this request":
        "You are not eligible to cast this vote, or you have already voted.",
      "Insufficient circle balance":
        "The circle does not have enough available funds for this request.",
      "Historical savings require reconciliation":
        "Historical savings need review before assignment. No funds have been moved.",
      "Insufficient savings destination balance":
        "This savings allocation is no longer available to reverse. No funds have been moved.",
      "Contribution has already been distributed":
        "This contribution has already been distributed and cannot be refunded again.",
      "Request an approved return before leaving":
        "Your contribution remains locked. Request an approved return before leaving.",
      "Return or withdraw circle funds before archiving":
        "Complete an approved return or withdrawal before archiving this circle.",
      "No outstanding contribution":
        "There are no outstanding contributions for this action.",
      "New target must be higher":
        "Enter a target higher than the current target.",
      "Select an eligible goal in the matching currency":
        "Select an eligible goal in the matching currency.",
      "Select an owned goal": "This savings goal is unavailable.",
      "Maximum 25 goals": "Maximum 25 active savings goals.",
      "Insufficient wallet balance":
        "Insufficient wallet balance for this operation.",
      "Idempotency key reused with different request":
        "This request identifier was already used for different input.",
      "Purchase not found": "Purchase not found.",
      "Purchase already refunded": "This purchase has already been refunded.",
      "Refund must reverse the original purchase":
        "Refund must reverse the original purchase.",
      "Savings settings changed":
        "Your savings settings or wallet activity changed. Generate a new report.",
    };
    if (error.message && messages[error.message])
      return new DatabaseError(messages[error.message], 409);
  }
  if (
    error.code === "23505" &&
    error.message?.includes("one_refund_per_purchase")
  )
    return new DatabaseError("This purchase has already been refunded.", 409);
  if (
    error.code === "23505" &&
    error.message?.includes("one_circle_merchant_refund")
  )
    return new DatabaseError(
      "This purchase has already been refunded. Its Circle contribution remains subject to group approval.",
      409,
    );
  // PostgREST errors can contain SQL internals; never forward arbitrary error text.
  return new DatabaseError(
    "The wallet database could not complete this request. Please retry; if it persists, check database configuration.",
    503,
  );
}
