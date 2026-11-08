import { CircleTimeline } from "./CircleTimeline";
import { useEffect, useRef, useState } from "react";
import {
  Users,
  Plus,
  Lock,
  Copy,
  Check,
  ArrowLeft,
  House,
  Plane,
  Heart,
  Target,
} from "lucide-react";
import { api } from "./api";
import { Button, Modal, PanelHead, CurrencySelect, field, date } from "./ui";
import { currencies, decimal, money, type Currency } from "../shared/money";
import type {
  Circle,
  CircleInvitation,
  CircleDetail,
  CircleProposal,
  SavingsQuote,
  SavingsDestination,
} from "../shared/circles";
import type { State } from "../shared/types";
import { goalAmount } from "./savings";
const amount = (v: string, c: Currency) => money(Number(v), c);
function CircleCover({ name }: { name?: string }) {
  const Icon =
    (
      {
        users: Users,
        home: House,
        plane: Plane,
        heart: Heart,
        target: Target,
      } as const
    )[name as "users"] || Users;
  return <Icon size={24} />;
}
const percent = (value: string, total: string) =>
  Number(total) > 0
    ? Number((BigInt(value) * 10000n) / BigInt(total)) / 100
    : 0;
export function Invitation({
  authenticated = false,
  onJoined,
  onDismiss,
}: {
  authenticated?: boolean;
  onJoined?: () => void;
  onDismiss?: () => void;
}) {
  const token = location.pathname.split("/").at(-1) || "";
  const [preview, setPreview] = useState<CircleInvitation>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    setPreview(undefined);
    setError("");
    const load = authenticated
      ? api<CircleInvitation>(
          `/circles/invitations/${encodeURIComponent(token)}`,
          undefined,
          "GET",
          {
            signal: controller.signal,
          },
        )
      : fetch(`/api/circles/invite/${encodeURIComponent(token)}`, {
          signal: controller.signal,
          cache: "no-store",
        }).then(async (r) => {
          if (!r.ok)
            throw new Error("This invitation is invalid, revoked, or expired.");
          return r.json();
        });
    void load
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [token, authenticated]);
  function openCircle(circleId: string) {
    sessionStorage.setItem("walletwise:open-circle", circleId);
    sessionStorage.removeItem("walletwise:circle-invite");
    history.replaceState({}, "", "/#Savings%20Circles");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    onJoined?.();
  }
  return (
    <section className="panel circle-invitation">
      <Users size={28} />
      <h2>
        {preview
          ? preview.alreadyMember
            ? preview.name
            : `Join ${preview.name}`
          : "Savings Circle invitation"}
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!preview && !error && <p role="status">Checking invitation…</p>}
      {preview && (
        <>
          <p>{preview.description}</p>
          <p>Shared target: {amount(preview.target, preview.currency)}</p>
          <p>
            Contributions are simulated and locked. Transfers require explicit
            approval from every contributor with an outstanding share. Members
            can see circle activity and contribution totals, never your private
            wallet.
          </p>
          {authenticated && preview.alreadyMember ? (
            <>
              <p role="status">You're already in this circle.</p>
              <Button onClick={() => openCircle(preview.circleId!)}>
                Open Circle
              </Button>
            </>
          ) : authenticated ? (
            <div className="actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api("/circles/join", { token, requestId: key.current })
                    .then((result: unknown) => {
                      const joined = result as {
                        id: string;
                        alreadyMember?: boolean;
                      };
                      if (joined.alreadyMember) {
                        setPreview({
                          ...preview,
                          alreadyMember: true,
                          circleId: joined.id,
                        });
                      } else openCircle(joined.id);
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Join Circle
              </Button>
              <Button
                secondary
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem("walletwise:circle-invite");
                  history.replaceState({}, "", "/#Home");
                  window.dispatchEvent(new HashChangeEvent("hashchange"));
                  onDismiss?.();
                }}
              >
                Not Now
              </Button>
            </div>
          ) : (
            <p>
              Sign in or register below, then confirm that you want to join.
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function Circles({
  state,
  onUpdated,
  onDestinationSaved,
}: {
  state: State;
  onUpdated: () => Promise<void>;
  onDestinationSaved: (destination: SavingsDestination) => void;
}) {
  const [circles, setCircles] = useState<Circle[]>([]),
    [selected, setSelected] = useState<string | undefined>(() => {
      const id = sessionStorage.getItem("walletwise:open-circle") || "";
      sessionStorage.removeItem("walletwise:open-circle");
      return /^[a-f0-9-]{36}$/i.test(id) ? id : undefined;
    }),
    [detail, setDetail] = useState<CircleDetail>(),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
      "create" | "invite" | "contribute" | "propose" | null
    >(null),
    [link, setLink] = useState(""),
    [copied, setCopied] = useState(false),
    [proposalKind, setProposalKind] =
      useState<CircleProposal["kind"]>("withdraw"),
    [returnMember, setReturnMember] = useState("");
  const [approveId, setApproveId] = useState<string>();
  const working = useRef(false);
  const formKey = useRef(crypto.randomUUID());
  const loadRequest = useRef<AbortController | undefined>(undefined);
  async function load() {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const [list, current] = await Promise.all([
        api<Circle[]>("/circles", undefined, "GET", {
          signal: controller.signal,
        }),
        selected
          ? api<CircleDetail>(`/circles/${selected}`, undefined, "GET", {
              signal: controller.signal,
            })
          : Promise.resolve(undefined),
      ]);
      if (controller.signal.aborted) return;
      setCircles(list);
      setDetail(current);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError((e as Error).message);
        setLoadFailed(true);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => loadRequest.current?.abort();
  }, [selected]);
  async function work(fn: () => Promise<unknown>, close = false) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (close) setModal(null);
      await load();
      await onUpdated();
      setNotice("Circle updated.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const action = (action: string, payload: Record<string, unknown> = {}) =>
    api(`/circles/${selected}/actions`, {
      requestId: crypto.randomUUID(),
      action,
      ...payload,
    });
  function open(value: typeof modal) {
    formKey.current = crypto.randomUUID();
    setError("");
    setModal(value);
  }
  async function invite() {
    setCopied(false);
    const result = await api<{ url: string }>(`/circles/${selected}/invite`, {
      requestId: crypto.randomUUID(),
    });
    setLink(result.url);
  }
  async function copyLink() {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select and copy the link manually.");
    }
  }
  const memberName = (id: string | null) =>
    detail?.members.find((m) => m.id === id)?.name || "Member";
  const you = detail?.members.find((m) => m.you);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="banner">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading circles…</p>}
      {loadFailed && (
        <Button disabled={loading} onClick={() => void load()}>
          Retry loading Circles
        </Button>
      )}
      {!selected ? (
        <section className="panel">
          <PanelHead
            title="Savings Circles"
            subtitle="Save together. Every contribution stays traceable."
            action={
              <Button onClick={() => open("create")}>
                <Plus size={16} />
                Create Circle
              </Button>
            }
          />
          {!loading && !circles.length && (
            <p>No circles yet. Start a shared goal with family or friends.</p>
          )}
          <div className="circle-grid">
            {circles.map((c) => (
              <button
                className="circle-card"
                key={c.id}
                onClick={() => {
                  setDetail(undefined);
                  setSelected(c.id);
                }}
              >
                <CircleCover name={c.icon} />
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                <strong>{amount(c.balance, c.currency)}</strong>
                <small> of {amount(c.target, c.currency)}</small>
                <progress
                  aria-label={`${c.name} progress`}
                  value={Math.min(Number(c.balance), Number(c.target))}
                  max={Number(c.target)}
                />
                <span>
                  {c.archived
                    ? "Archived"
                    : c.reached
                      ? "Goal reached"
                      : `${percent(c.balance, c.target)}% saved`}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        detail && (
          <>
            <div className="actions circle-navigation">
              <Button
                secondary
                disabled={busy || loading}
                onClick={() => void load()}
              >
                Refresh Circle
              </Button>
              <Button
                secondary
                onClick={() => {
                  setSelected(undefined);
                  setDetail(undefined);
                }}
              >
                <ArrowLeft size={16} />
                All circles
              </Button>
            </div>
            <section className="panel circle-overview">
              <PanelHead
                title={detail.name}
                subtitle={detail.description || "A shared savings goal."}
                action={
                  <span className="pill">
                    <Lock size={13} />
                    Locked savings
                  </span>
                }
              />
              <div className="circle-metrics">
                <div>
                  <small>Shared savings</small>
                  <h2>{amount(detail.balance, detail.currency)}</h2>
                </div>
                <div>
                  <small>Target</small>
                  <strong>{amount(detail.target, detail.currency)}</strong>
                </div>
                <div>
                  <small>Remaining</small>
                  <strong>
                    {money(
                      Math.max(
                        0,
                        Number(detail.target) - Number(detail.balance),
                      ),
                      detail.currency,
                    )}
                  </strong>
                </div>
              </div>
              <progress
                aria-label="Circle progress"
                value={Math.min(Number(detail.balance), Number(detail.target))}
                max={Number(detail.target)}
              />
              <p>
                {Math.min(100, percent(detail.balance, detail.target))}% saved
                {detail.targetDate && ` · Target ${date(detail.targetDate)}`}
              </p>
              {detail.reached && !detail.archived && (
                <div className="banner" role="status">
                  <Check size={18} />
                  Goal reached. Automatic contributions are paused. What should
                  we do next?
                </div>
              )}
              <div className="actions">
                {!detail.archived && (
                  <>
                    <Button
                      disabled={
                        busy ||
                        detail.reached ||
                        detail.proposals.some(
                          (p) =>
                            [
                              "Pending",
                              "Approved",
                              "Executing",
                              "Failed",
                            ].includes(p.status) &&
                            Date.parse(p.expiresAt) > Date.now(),
                        )
                      }
                      onClick={() => open("contribute")}
                    >
                      Contribute
                    </Button>
                    <Button
                      secondary
                      disabled={busy || detail.reached}
                      onClick={() =>
                        void work(() =>
                          api<SavingsDestination>(
                            "/savings/destination",
                            { kind: "circle", id: detail.id, enable: true },
                            "PUT",
                          ).then(onDestinationSaved),
                        )
                      }
                    >
                      Use for Smart Savings
                    </Button>
                    {detail.owner ? (
                      <>
                        <Button
                          secondary
                          disabled={busy}
                          onClick={() => {
                            open("invite");
                            void work(invite);
                          }}
                        >
                          Invite Members
                        </Button>
                        <Button
                          secondary
                          disabled={busy || Number(detail.balance) === 0}
                          onClick={() => {
                            setProposalKind("withdraw");
                            setReturnMember(you?.id || "");
                            open("propose");
                          }}
                        >
                          Request Withdrawal
                        </Button>
                        <Button
                          secondary
                          disabled={busy || Number(detail.balance) === 0}
                          onClick={() => {
                            setProposalKind("target");
                            open("propose");
                          }}
                        >
                          Propose next step
                        </Button>
                        <Button
                          secondary
                          disabled={busy || Number(detail.balance) !== 0}
                          onClick={() => void work(() => action("archive"))}
                        >
                          Archive Circle
                        </Button>
                      </>
                    ) : Number(you?.share) > 0 ? (
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() =>
                          void work(() => action("request_return"))
                        }
                      >
                        Request return of my contribution
                      </Button>
                    ) : (
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await action("leave");
                            setSelected(undefined);
                            setDetail(undefined);
                          })
                        }
                      >
                        Leave Circle
                      </Button>
                    )}
                  </>
                )}
              </div>
              <p>
                Contributions pause while an active request locks the Circle.
                Every required contributor must approve the exact terms.
              </p>
              <p className="footnote">
                Simulated wallet balances. No pooled PayPal account or live
                payout.
              </p>
            </section>
            <section className="panel">
              <PanelHead
                title="Member contributions"
                subtitle="Outstanding shares in the locked circle balance."
              />
              <div
                className="contribution-stack"
                role="img"
                aria-label="Member shares; exact amounts and percentages follow"
              >
                {detail.members.map(
                  (m, i) =>
                    Number(m.share) > 0 && (
                      <span
                        key={m.id}
                        style={{
                          width: `${percent(m.share, detail.balance)}%`,
                          background: [
                            "#287963",
                            "#296ca4",
                            "#9a6634",
                            "#53668e",
                            "#536c70",
                          ][i % 5],
                        }}
                      />
                    ),
                )}
              </div>
              <p>
                {detail.members.filter((m) => m.active).length} active members -{" "}
                {detail.proposals.filter((p) => p.status === "Pending").length}{" "}
                pending votes
              </p>
              <div className="circle-members">
                {detail.members.map((m, i) => (
                  <div className="circle-member" key={m.id}>
                    <span>
                      <strong>
                        <span
                          className="member-swatch"
                          style={{
                            background: [
                              "#287963",
                              "#296ca4",
                              "#9a6634",
                              "#53668e",
                              "#536c70",
                            ][i % 5],
                          }}
                        />{" "}
                        {m.name}
                        {m.you ? " (You)" : ""}
                      </strong>
                      <small>
                        {m.owner
                          ? "Owner"
                          : m.active
                            ? "Member"
                            : "Former member"}
                      </small>
                    </span>
                    <span>
                      {amount(m.share, detail.currency)} ·{" "}
                      {percent(m.share, detail.balance)}%
                    </span>
                    <progress
                      aria-label={`${m.name} contribution share`}
                      value={Number(m.share)}
                      max={Math.max(1, Number(detail.balance))}
                    />
                    <details className="member-history">
                      <summary>Recent contribution history</summary>
                      <ul>
                        {detail.entries
                          .filter((e) => e.memberId === m.id)
                          .map((e) => (
                            <li key={e.id}>
                              {e.kind}: {amount(e.amount, detail.currency)} -{" "}
                              {new Date(e.at).toLocaleString()}
                            </li>
                          ))}
                      </ul>
                      <small>
                        The latest recorded entries are shown here. Load the
                        Circle activity timeline for older records.
                      </small>
                    </details>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <PanelHead
                title="Votes and requests"
                subtitle="Every contributor in the fixed snapshot must approve."
              />
              {!detail.proposals.length && (
                <p>No withdrawal or change requests.</p>
              )}
              {detail.proposals.map((p) => {
                const approvals = p.votes.filter(
                    (v) => v.decision === "Approve",
                  ).length,
                  own = p.votes.find((v) => v.memberId === you?.id);
                return (
                  <article className="circle-proposal" key={p.id}>
                    <div className="row between">
                      <h3>{p.kind.replaceAll("_", " ")}</h3>
                      <span className="pill">{p.status}</span>
                    </div>
                    <p>{p.reason}</p>
                    <dl>
                      <dt>{p.kind === "target" ? "New target" : "Amount"}</dt>
                      <dd>{amount(p.amount, p.currency)}</dd>
                      <dt>Destination</dt>
                      <dd>
                        {p.kind === "return_all"
                          ? "Original contributors"
                          : p.kind === "target"
                            ? "Circle target"
                            : memberName(p.destination)}
                        {p.kind === "withdraw" || p.kind === "return_member"
                          ? " · Simulated wallet"
                          : ""}
                      </dd>
                      <dt>Fees</dt>
                      <dd>{amount(p.fee, p.currency)}</dd>
                      <dt>Remaining</dt>
                      <dd>{amount(p.remaining, p.currency)}</dd>
                      <dt>Created</dt>
                      <dd>
                        {p.createdAt
                          ? new Date(p.createdAt).toLocaleString()
                          : "Not recorded"}
                      </dd>
                      <dt>Requested by</dt>
                      <dd>
                        {p.creatorId
                          ? memberName(p.creatorId)
                          : "Not recorded in this historical request"}
                      </dd>
                      <dt>Expires</dt>
                      <dd>{new Date(p.expiresAt).toLocaleString()}</dd>
                    </dl>
                    <strong>
                      {p.status === "Pending" ? "Request locked — " : ""}
                      {approvals} of {p.votes.length} approvals
                    </strong>
                    <progress
                      aria-label="Approval progress"
                      value={approvals}
                      max={Math.max(1, p.votes.length)}
                    />
                    <ul>
                      {p.votes.map((v) => (
                        <li key={v.memberId}>
                          {memberName(v.memberId)}:{" "}
                          {v.decision
                            ? v.decision === "Approve"
                              ? "Approved"
                              : "Rejected"
                            : "Pending"}
                        </li>
                      ))}
                    </ul>
                    {p.error && <p role="alert">{p.error}</p>}
                    <div className="actions">
                      {p.status === "Pending" &&
                        Date.parse(p.expiresAt) > Date.now() &&
                        own &&
                        !own.decision && (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() => setApproveId(p.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              secondary
                              disabled={busy}
                              onClick={() =>
                                void work(() =>
                                  action("vote", {
                                    proposalId: p.id,
                                    decision: "Reject",
                                  }),
                                )
                              }
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      {detail.owner &&
                        ["Approved", "Failed"].includes(p.status) && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void work(() =>
                                action("execute", { proposalId: p.id }),
                              )
                            }
                          >
                            {p.status === "Failed"
                              ? "Retry approved transfer"
                              : "Execute approved request"}
                          </Button>
                        )}
                      {detail.owner &&
                        ["Pending", "Approved", "Failed"].includes(
                          p.status,
                        ) && (
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() =>
                              void work(() =>
                                action("cancel", { proposalId: p.id }),
                              )
                            }
                          >
                            Cancel request
                          </Button>
                        )}
                    </div>
                  </article>
                );
              })}
            </section>
            <CircleTimeline
              circle={detail}
              busy={busy}
              onReturn={(id) => {
                setProposalKind("return_member");
                setReturnMember(id);
                open("propose");
              }}
            />
          </>
        )
      )}
      {approveId &&
        detail &&
        (() => {
          const p = detail.proposals.find((p) => p.id === approveId);
          return p ? (
            <Modal
              title="Confirm Circle approval"
              onClose={() => {
                if (!busy) setApproveId(undefined);
              }}
              error={error}
            >
              <p>
                Approve {p.kind.replaceAll("_", " ")} for{" "}
                {amount(p.amount, p.currency)}?
              </p>
              <p>
                Destination:{" "}
                {p.kind === "return_all"
                  ? "Original contributors"
                  : p.kind === "target"
                    ? "Circle target"
                    : memberName(p.destination)}
                . Fees: {amount(p.fee, p.currency)}.
              </p>
              <p>{p.reason}</p>
              <p>
                Your approval applies to these fixed terms. Funds remain locked
                until every required contributor approves and the owner executes
                the request.
              </p>
              <div className="actions">
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => setApproveId(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    busy ||
                    p.status !== "Pending" ||
                    Date.parse(p.expiresAt) <= Date.now()
                  }
                  onClick={() =>
                    void work(() =>
                      action("vote", { proposalId: p.id, decision: "Approve" }),
                    ).then((ok) => {
                      if (ok) setApproveId(undefined);
                    })
                  }
                >
                  Confirm approval
                </Button>
              </div>
            </Modal>
          ) : null;
        })()}
      {modal && (
        <Modal
          title={
            modal === "create"
              ? "Create Savings Circle"
              : modal === "invite"
                ? "Invite Members"
                : modal === "contribute"
                  ? "Contribute to Circle"
                  : "Request unanimous approval"
          }
          onClose={() => setModal(null)}
          error={error}
        >
          {modal === "create" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void work(async () => {
                  const c = await api<Circle>("/circles", {
                    requestId: formKey.current,
                    name: field(f, "name"),
                    description: field(f, "description"),
                    amount: field(f, "amount"),
                    currency: field(f, "currency"),
                    targetDate: field(f, "targetDate") || undefined,
                    icon: field(f, "icon"),
                  });
                  setSelected(c.id);
                }, true);
              }}
            >
              <label>
                Circle name
                <input name="name" required maxLength={60} />
              </label>
              <label>
                Description (optional)
                <textarea name="description" maxLength={500} />
              </label>
              <div className="form-grid">
                <label>
                  Currency
                  <CurrencySelect />
                </label>
                <label>
                  Target amount
                  <input name="amount" required inputMode="decimal" />
                </label>
              </div>
              <label>
                Target date (optional)
                <input type="date" name="targetDate" />
              </label>
              <label>
                Cover icon
                <select name="icon">
                  {["users", "home", "plane", "heart", "target"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy}>
                Create Circle
              </Button>
            </form>
          )}
          {modal === "invite" && (
            <>
              <p>
                Anyone with this link can preview the goal. Joining requires
                sign-in and confirmation. The link expires in seven days.
              </p>
              {link && (
                <label>
                  Invitation link
                  <input readOnly value={link} />
                </label>
              )}
              <div className="actions">
                <Button
                  disabled={busy || !link}
                  onClick={() => void copyLink()}
                >
                  <Copy size={16} />
                  {copied ? "Copied" : "Copy Link"}
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => void work(invite)}
                >
                  Regenerate Link
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => void work(() => action("revoke"), true)}
                >
                  Revoke Link
                </Button>
              </div>
            </>
          )}
          {modal === "contribute" && detail && (
            <Contribution
              circle={detail}
              state={state}
              busy={busy}
              submit={(body) =>
                work(() => api(`/circles/${detail.id}/contribute`, body), true)
              }
            />
          )}
          {modal === "propose" && detail && (
            <Proposal
              circle={detail}
              initialKind={proposalKind}
              initialMember={returnMember}
              busy={busy}
              requestId={formKey.current}
              submit={(body) =>
                work(() => api(`/circles/${detail.id}/actions`, body), true)
              }
            />
          )}
        </Modal>
      )}
    </>
  );
}
function Contribution({
  circle,
  state,
  busy,
  submit,
}: {
  circle: CircleDetail;
  state: State;
  busy: boolean;
  submit: (body: unknown) => Promise<boolean>;
}) {
  const [currency, setCurrency] = useState<Currency>(circle.currency),
    [value, setValue] = useState(""),
    [source, setSource] = useState(""),
    [quote, setQuote] = useState<SavingsQuote>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const key = useRef(crypto.randomUUID());
  const reset = () => {
    setQuote(undefined);
    setError("");
    key.current = crypto.randomUUID();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (quote) {
          void submit({
            requestId: key.current,
            currency,
            amount: value,
            quoteId: quote.id,
            sourceGoal: source || null,
            confirmed: true,
          });
          return;
        }
        setLoading(true);
        void api<{ quote: SavingsQuote }>("/savings/preview", {
          currency,
          amount: value,
          destination: { kind: "circle", id: circle.id },
        })
          .then((v) => setQuote(v.quote))
          .catch((e) => setError(e.message))
          .finally(() => setLoading(false));
      }}
    >
      <label>
        Source
        <select
          value={source}
          onChange={(e) => {
            reset();
            setSource(e.target.value);
            const goal = state.goals.find((g) => g.id === e.target.value);
            if (goal) setCurrency(goal.currency);
          }}
        >
          <option value="">Available wallet funds</option>
          {state.goals
            .filter((g) => goalAmount(state, g.id) > 0)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {money(goalAmount(state, g.id), g.currency)}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Currency
          <select
            value={currency}
            disabled={!!source}
            onChange={(e) => {
              reset();
              setCurrency(e.target.value as Currency);
            }}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Contribution amount
          <input
            required
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              reset();
              setValue(e.target.value);
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {quote && (
        <div className="preview-box">
          <p>
            Debit {money(Number(quote.source_minor), currency)} from{" "}
            {source ? "your personal savings goal" : "your available wallet"}.
          </p>
          <p>
            Credit {money(Number(quote.target_minor), quote.target_currency)} to{" "}
            {circle.name}.
          </p>
          <p>
            Rate {(Number(quote.rate_units) / 1000000).toFixed(6)} · Fees{" "}
            {money(Number(quote.fee_minor), currency)} · Simulated conversion.
          </p>
          <p>
            Circle funds are locked. This contribution cannot be withdrawn
            unilaterally.
          </p>
        </div>
      )}
      <Button type="submit" disabled={busy || loading || !value}>
        {quote ? "Confirm contribution" : "Review contribution"}
      </Button>
    </form>
  );
}
function Proposal({
  circle,
  initialKind,
  initialMember,
  busy,
  requestId,
  submit,
}: {
  circle: CircleDetail;
  initialKind: CircleProposal["kind"];
  initialMember: string;
  busy: boolean;
  requestId: string;
  submit: (body: unknown) => Promise<boolean>;
}) {
  const [kind, setKind] = useState(initialKind),
    [member, setMember] = useState(
      initialMember || circle.members.find((m) => m.you)?.id || "",
    ),
    [value, setValue] = useState(
      decimal(Number(circle.balance), circle.currency),
    ),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(false);
  const finalAmount =
    kind === "return_all"
      ? decimal(Number(circle.balance), circle.currency)
      : kind === "return_member"
        ? decimal(
            Number(circle.members.find((m) => m.id === member)?.share || 0),
            circle.currency,
          )
        : kind === "owner"
          ? "0"
          : value;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!review) {
          setReview(true);
          return;
        }
        void submit({
          requestId,
          action: "propose",
          kind,
          amount: finalAmount,
          currency: circle.currency,
          destination: ["withdraw", "return_member", "owner"].includes(kind)
            ? member
            : null,
          reason,
          confirmed: true,
        });
      }}
      onChange={() => setReview(false)}
    >
      <label>
        Proposal
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="withdraw">Withdraw for the goal</option>
          <option value="target">Increase the target</option>
          <option value="return_all">
            Return all outstanding contributions
          </option>
          <option value="return_member">Return one contributor's share</option>
          <option value="owner">Approve a new owner</option>
        </select>
      </label>
      {["withdraw", "return_member", "owner"].includes(kind) && (
        <label>
          {kind === "owner" ? "New owner" : "Destination simulated wallet"}
          <select value={member} onChange={(e) => setMember(e.target.value)}>
            {circle.members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {["withdraw", "target"].includes(kind) && (
        <label>
          {kind === "target" ? "New target" : "Withdrawal amount"} (
          {circle.currency})
          <input
            required
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      )}
      <label>
        Reason
        <textarea
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {review && (
        <div className="preview-box">
          <p>
            {kind.replaceAll("_", " ")} · {finalAmount} {circle.currency} ·
            Fees: {money(0, circle.currency)}
          </p>
          <p>{reason}</p>
          <p>
            All current contributors must explicitly approve these exact terms.
            Contributions stay paused while voting is open.
          </p>
        </div>
      )}
      <Button type="submit" disabled={busy}>
        {review ? "Submit approval request" : "Review request"}
      </Button>
    </form>
  );
}
