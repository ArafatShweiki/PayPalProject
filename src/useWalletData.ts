import { useEffect, useRef, useState } from "react";
import type { ActivityPage, Bootstrap, State } from "../shared/types";
import { api } from "./api";
import { ApiError } from "./errors";
import { finishStage, startStage } from "./performance";
export type Section = "overview" | "activity";
type Resource = { loading: boolean; error?: unknown };
type Filter = {
  from?: string;
  to?: string;
  currency?: string;
  category?: string;
  savings?: boolean;
};
export function useWalletData(initial: State | undefined, page: string) {
  const [data, setData] = useState<State | undefined>(initial),
    [essentialError, setEssentialError] = useState<unknown>();
  const [revision, setRevision] = useState(0),
    [overviewVersion, setOverviewVersion] = useState(0),
    [activityVersion, setActivityVersion] = useState(0);
  const [sections, setSections] = useState<Record<Section, Resource>>({
    overview: { loading: true },
    activity: { loading: true },
  });
  const [filter, setFilter] = useState<Filter>({
      savings: page === "Smart Savings",
    }),
    [cursor, setCursor] = useState<string | null>(null),
    [moreLoading, setMoreLoading] = useState(false);
  const pageRequest = useRef<AbortController | undefined>(undefined);
  const setState = (work: React.SetStateAction<State | undefined>) =>
    setData(work);
  const refresh = async (signal?: AbortSignal) => {
    startStage("wallet_essential");
    const loaded = await api<Bootstrap>("/bootstrap", undefined, "GET", {
      signal,
    });
    if (!loaded.onboarding.complete || !loaded.state) {
      window.dispatchEvent(new Event("walletwise:onboarding-required"));
      throw new ApiError("Complete your profile to open your wallet.", 403);
    }
    setEssentialError(undefined);
    setSections({ overview: { loading: true }, activity: { loading: true } });
    setData((current) => ({
      ...loaded.state!,
      snapshots: current?.snapshots || [],
      marketStatus: current?.marketStatus,
    }));
    setRevision((value) => value + 1);
    finishStage("wallet_essential");
  };
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setEssentialError(error);
    });
    return () => controller.abort();
  }, []);
  const ready = !!data;
  useEffect(() => {
    if (ready) finishStage("dashboard_usable");
  }, [ready]);
  useEffect(() => {
    setFilter({ savings: page === "Smart Savings" });
  }, [page]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let active = true;
    setSections((value) => ({ ...value, overview: { loading: true } }));
    startStage("overview");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void api<
      Pick<
        State,
        | "goals"
        | "alerts"
        | "notices"
        | "reports"
        | "recommendations"
        | "createdAt"
        | "dashboard"
        | "reportTotal"
      >
    >(`/dashboard?timezone=${encodeURIComponent(timezone)}`, undefined, "GET", {
      signal: controller.signal,
    })
      .then((value) => {
        if (active) {
          setData((current) =>
            current
              ? {
                  ...current,
                  goals: value.goals,
                  alerts: value.alerts,
                  notices: value.notices,
                  reports: value.reports,
                  recommendations: value.recommendations,
                  createdAt: value.createdAt,
                  dashboard: value.dashboard,
                  reportTotal: value.reportTotal,
                }
              : current,
          );
          setSections((s) => ({ ...s, overview: { loading: false } }));
          finishStage("overview");
        }
      })
      .catch((error) => {
        if (active)
          setSections((s) => ({ ...s, overview: { loading: false, error } }));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [ready, revision, overviewVersion]);
  const activityPath = (next?: string) => {
    const params = new URLSearchParams({ limit: "25" });
    if (filter.currency) params.set("currency", filter.currency);
    if (filter.category) params.set("category", filter.category);
    if (filter.savings) params.set("savings", "true");
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    if (next) params.set("cursor", next);
    return `/activity?${params}`;
  };
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let active = true;
    pageRequest.current?.abort();
    setMoreLoading(false);
    setCursor(null);
    setSections((s) => ({ ...s, activity: { loading: true } }));
    startStage("activity");
    void api<ActivityPage>(activityPath(), undefined, "GET", {
      signal: controller.signal,
    })
      .then((value) => {
        if (active) {
          setData((current) =>
            current
              ? { ...current, ledger: value.entries.slice().reverse() }
              : current,
          );
          setCursor(value.nextCursor);
          setSections((s) => ({ ...s, activity: { loading: false } }));
          finishStage("activity");
        }
      })
      .catch((error) => {
        if (active)
          setSections((s) => ({ ...s, activity: { loading: false, error } }));
      });
    return () => {
      active = false;
      controller.abort();
      pageRequest.current?.abort();
    };
  }, [
    ready,
    revision,
    activityVersion,
    filter.currency,
    filter.category,
    filter.savings,
    filter.from,
    filter.to,
  ]);
  const loadMore = async () => {
    if (!cursor || moreLoading) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setMoreLoading(true);
    try {
      const value = await api<ActivityPage>(
        activityPath(cursor),
        undefined,
        "GET",
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setData((current) => {
        if (!current) return current;
        const entries = new Map(
          [...value.entries, ...current.ledger].map((e) => [e.id, e]),
        );
        return {
          ...current,
          ledger: [...entries.values()].sort(
            (a, b) => Date.parse(a.at) - Date.parse(b.at),
          ),
        };
      });
      setCursor(value.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted)
        setSections((s) => ({ ...s, activity: { loading: false, error } }));
    } finally {
      if (!controller.signal.aborted) setMoreLoading(false);
    }
  };
  const state = data
    ? {
        ...data,
        loadingSections: Object.entries(sections)
          .filter(([, value]) => value.loading)
          .map(([key]) => key),
      }
    : undefined;
  return {
    state,
    setState,
    essentialError,
    sections,
    refresh,
    loadMore,
    hasMore: !!cursor,
    moreLoading,
    setActivityFilter: (
      currency: string,
      category: string,
      from: string,
      to: string,
    ) => {
      const next = {
        ...filter,
        currency: currency === "all" ? undefined : currency,
        category: category === "all" ? undefined : category,
        from: from || undefined,
        to: to || undefined,
      };
      if (
        next.currency === filter.currency &&
        next.category === filter.category &&
        next.from === filter.from &&
        next.to === filter.to
      )
        return;
      setSections((value) => ({ ...value, activity: { loading: true } }));
      setFilter(next);
    },
    retrySection: (section: Section) =>
      section === "overview"
        ? setOverviewVersion((v) => v + 1)
        : setActivityVersion((v) => v + 1),
  };
}
