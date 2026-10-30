import { useEffect, useState } from "react";
import { ApiError, errorCopy, errorStatus } from "./errors";
import { Button } from "./ui";
import { ShieldAlert } from "lucide-react";
export function ErrorState({
  error,
  status,
  onRetry,
}: {
  error?: unknown;
  status?: number;
  onRetry?: () => void;
}) {
  const code = status ?? errorStatus(error),
    copy = errorCopy[code] ?? errorCopy[500];
  const deadline = error instanceof ApiError ? error.retryAfter : 0;
  const [remaining, setRemaining] = useState(deadline);
  useEffect(() => {
    setRemaining(deadline);
    if (!deadline) return;
    const end = Date.now() + deadline * 1000;
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [deadline, error]);
  return (
    <section className="error-state" role="alert">
      <ShieldAlert size={32} aria-hidden="true" />
      <span className="eyebrow">DREAM PIGGY BANK · {code}</span>
      <h1>{copy.title}</h1>
      <p>{copy.message}</p>
      {code === 429 && (
        <p aria-live="polite">
          {remaining > 0
            ? `Try again in ${remaining} seconds.`
            : "You can try again now."}
        </p>
      )}
      {error instanceof ApiError && error.requestId && (
        <small>Reference: {error.requestId}</small>
      )}
      <div className="actions">
        {code === 401 ? (
          <a className="button" href="/#Home">
            Sign in
          </a>
        ) : onRetry ? (
          <Button disabled={remaining > 0} onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <a className="button" href="/#Home">
            Return to Home
          </a>
        )}
        <Button secondary onClick={() => history.back()}>
          Go back
        </Button>
      </div>
    </section>
  );
}
