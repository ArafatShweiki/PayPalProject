import type { ReactNode } from "react";
import { CardSkeleton, Skeleton } from "./Skeleton";
import { Button } from "./ui";
export function DeferredSection({
  loading,
  error,
  retry,
  label,
  children,
  compact,
}: {
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  if (loading)
    return (
      <div
        className="deferred-content"
        role="status"
        aria-label={`Loading ${label}`}
      >
        {compact ? <Skeleton className="shape-value" /> : <CardSkeleton />}
      </div>
    );
  if (error)
    return (
      <div role="alert">
        <p>We couldn't load {label}. Your wallet is still available.</p>
        {retry && (
          <Button secondary onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    );
  return <>{children}</>;
}
