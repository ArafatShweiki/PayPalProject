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
      "Insufficient wallet balance":
        "Insufficient wallet balance for this operation.",
      "Idempotency key reused with different request":
        "This request identifier was already used for different input.",
      "Purchase not found": "Purchase not found.",
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
  // PostgREST errors can contain SQL internals; never forward arbitrary error text.
  return new DatabaseError(
    "The wallet database could not complete this request. Please retry; if it persists, check database configuration.",
    503,
  );
}
