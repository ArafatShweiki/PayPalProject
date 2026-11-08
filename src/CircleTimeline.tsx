import { useEffect, useRef, useState } from "react";
import type { CircleDetail, TimelineEvent } from "../shared/circles";
import { money } from "../shared/money";
import { api } from "./api";
import { Button, PanelHead } from "./ui";
export function CircleTimeline({
  circle,
  busy,
  onReturn,
}: {
  circle: CircleDetail;
  busy: boolean;
  onReturn: (memberId: string) => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const active = useRef<AbortController | undefined>(undefined);
  async function load(append = false) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    const last = append ? events.at(-1) : undefined;
    try {
      const page = await api<{ events: TimelineEvent[]; more: boolean }>(
        `/circles/${circle.id}/timeline${last ? `?before=${encodeURIComponent(last.at)}&id=${last.id}` : ""}`,
        undefined,
        "GET",
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!Array.isArray(page?.events))
        throw new Error("Invalid activity response");
      setEvents((old) =>
        append
          ? [
              ...old,
              ...page.events.filter((e) => !old.some((v) => v.id === e.id)),
            ]
          : page.events,
      );
      setMore(page.more);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Circle activity could not be loaded. Recorded balances are unchanged.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    setEvents([]);
    void load();
    return () => active.current?.abort();
  }, [circle]);
  const memberName = (id: string | null) =>
    circle.members.find((m) => m.id === id)?.name || "Member";
  return (
    <section className="panel">
      <PanelHead
        title="Circle activity"
        subtitle="Recorded contributions, milestones and decisions - newest first"
      />
      {!events.length && !loading && !error && <p>No recorded activity yet.</p>}
      <ol className="circle-timeline">
        {events.map((e) => (
          <li key={e.id}>
            <div>
              <strong>
                {e.event === "milestone"
                  ? `Circle reached ${Number(e.details.threshold)}%`
                  : `${memberName(e.memberId)} - ${e.event.replaceAll("_", " ")}`}
              </strong>
              {["contribution", "distribution", "reversal"].includes(e.event) &&
                typeof e.details.amount === "string" &&
                /^-?\d+$/.test(e.details.amount) &&
                Number.isSafeInteger(Number(e.details.amount)) && (
                  <p>{money(Number(e.details.amount), circle.currency)}</p>
                )}
              {e.event === "vote" &&
                (e.details.decision === "Approve" ||
                  e.details.decision === "Reject") && (
                  <p>
                    {e.details.decision === "Approve"
                      ? "Approved the fixed request terms"
                      : "Rejected the request"}
                  </p>
                )}
              {e.event === "request_return" && circle.owner && e.memberId && (
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => onReturn(e.memberId!)}
                >
                  Propose contributor return
                </Button>
              )}
            </div>
            <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
          </li>
        ))}
      </ol>
      {loading && <p role="status">Loading Circle activity...</p>}
      {error && <p role="alert">{error}</p>}
      {(more || error) && (
        <Button
          secondary
          disabled={loading}
          onClick={() => void load(events.length > 0)}
        >
          {error ? "Retry Circle activity" : "Load more Circle activity"}
        </Button>
      )}
    </section>
  );
}
