import type { ReactNode } from "react";
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`loading-shape ${className}`} aria-hidden="true" />;
}
export function CardSkeleton({
  kind = "card",
}: {
  kind?: "card" | "chart" | "table" | "goal" | "profile" | "report";
}) {
  return (
    <div className={`card-skeleton skeleton-${kind}`} aria-hidden="true">
      <Skeleton className="shape-label" />
      <Skeleton className="shape-value" />
      {kind === "chart" ? (
        <Skeleton className="shape-chart" />
      ) : kind === "table" ? (
        Array.from({ length: 5 }, (_, i) => (
          <div className="skeleton-table-row" key={i}>
            <Skeleton className="shape-icon" />
            <Skeleton />
            <Skeleton className="shape-label" />
          </div>
        ))
      ) : kind === "goal" ? (
        <>
          <Skeleton className="shape-chart" />
          <Skeleton />
        </>
      ) : (
        <>
          <Skeleton />
          <Skeleton className="shape-label" />
        </>
      )}
    </div>
  );
}
export function PageSkeleton({ area = "Home" }: { area?: string }) {
  let content: ReactNode;
  if (area === "Home")
    content = (
      <>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <CardSkeleton />
        <CardSkeleton />
        <div className="bento-half">
          <CardSkeleton kind="chart" />
        </div>
        <div className="bento-half">
          <CardSkeleton kind="chart" />
        </div>
        <div className="bento-half">
          <CardSkeleton kind="table" />
        </div>
        <CardSkeleton kind="goal" />
        <CardSkeleton />
      </>
    );
  else if (area === "Smart Savings")
    content = (
      <>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-wide skeleton-goal-row">
          <CardSkeleton kind="goal" />
          <CardSkeleton kind="goal" />
          <CardSkeleton kind="goal" />
        </div>
        <div className="bento-wide">
          <CardSkeleton kind="profile" />
        </div>
      </>
    );
  else if (area === "My Wallet")
    content = (
      <>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-wide">
          <CardSkeleton kind="table" />
        </div>
      </>
    );
  else if (area === "Currency Rates")
    content = (
      <>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-half">
          <CardSkeleton />
        </div>
        <div className="bento-wide">
          <CardSkeleton kind="chart" />
        </div>
      </>
    );
  else
    content = (
      <div className="bento-wide">
        <CardSkeleton kind={area === "Reports" ? "report" : "profile"} />
      </div>
    );
  return (
    <div
      className="page-skeleton"
      role="status"
      aria-label={`Loading ${area}`}
      aria-busy="true"
    >
      <span className="sr-only">Loading {area}…</span>
      <div className="bento-grid">{content}</div>
    </div>
  );
}
