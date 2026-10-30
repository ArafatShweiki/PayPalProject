import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AuthRoot } from "./Auth";
import { InfoFooter } from "./InfoNavigation";
import { ErrorState } from "./ErrorState";
import { CardSkeleton } from "./Skeleton";
import "./styles.css";
const PublicPage = lazy(() => import("./PublicPages"));
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.error("Dream Piggy Bank encountered a rendering error.");
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <ErrorState status={500} onRetry={() => location.reload()} />
      </main>
    ) : (
      this.props.children
    );
  }
}
const appPaths = ["/", "/onboarding", "/reset-password"];
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {appPaths.includes(location.pathname) ? (
      <AuthRoot />
    ) : (
      <Suspense
        fallback={
          <main className="info-main" role="status" aria-label="Loading page">
            <CardSkeleton kind="profile" />
          </main>
        }
      >
        <PublicPage path={location.pathname.replace(/\/$/, "")} />
      </Suspense>
    )}
    <InfoFooter />
  </ErrorBoundary>,
);
