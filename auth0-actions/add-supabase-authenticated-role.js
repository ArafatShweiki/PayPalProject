/**
 * Attach this Post Login Action to the Auth0 Login flow.
 * Supabase's Auth0 third-party integration requires this role in the ID token.
 */
exports.onExecutePostLogin = async (_event, api) => {
  api.idToken.setCustomClaim("role", "authenticated");
};
