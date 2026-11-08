import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (value: string) =>
  value ? new Date(`${value}T12:00:00`) : new Date();

export function DatePicker({
  label,
  value,
  onChange,
  disabled = false,
  max,
  placeholder = "Select date",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  max?: string;
  placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parse(value));
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const today = key(new Date());
  const month = cursor.getMonth(),
    year = cursor.getFullYear();
  const first = new Date(year, month, 1, 12);
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(year, month, i - first.getDay() + 1, 12),
  );
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(date: string) {
    if (date && max && date > max) return;
    onChange(date);
    close();
  }
  useEffect(() => {
    if (!open || disabled) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function reposition() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.offsetHeight ?? 350;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 308)),
        top: Math.max(
          12,
          rect.bottom + height + 8 <= window.innerHeight
            ? rect.bottom + 8
            : rect.top - height - 8,
        ),
      });
    }
    reposition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, disabled]);
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${key(cursor)}"]`)
        ?.focus();
  }, [open, cursor]);
  function moveMonth(delta: number) {
    const target = new Date(year, month + delta, 1, 12);
    target.setDate(
      Math.min(
        cursor.getDate(),
        new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(),
      ),
    );
    setCursor(max && key(target) > max ? parse(max) : target);
  }
  return (
    <div
      className="date-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <span id={`${id}-label`} className="date-picker-label">
        {label}
      </span>
      <button
        ref={trigger}
        disabled={disabled}
        type="button"
        className={`date-picker-trigger${value ? " has-value" : ""}`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-calendar` : undefined}
        onClick={() => {
          setCursor(parse(value));
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {value
            ? parse(value).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : placeholder}
        </span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div
          ref={panel}
          id={`${id}-calendar`}
          role="dialog"
          aria-label={`${label} date`}
          className="date-calendar"
          style={position}
        >
          <div className="date-calendar-head">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong aria-live="polite">
              {cursor.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="date-weekdays" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="date-days" role="group" aria-label="Choose a day">
            {days.map((d) => (
              <button
                key={key(d)}
                type="button"
                data-date={key(d)}
                disabled={!!max && key(d) > max}
                tabIndex={key(d) === key(cursor) ? 0 : -1}
                aria-label={d.toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                aria-pressed={key(d) === value}
                aria-current={key(d) === today ? "date" : undefined}
                className={d.getMonth() !== month ? "outside-month" : undefined}
                onClick={() => choose(key(d))}
                onKeyDown={(e) => {
                  const offsets: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                    Home: -d.getDay(),
                    End: 6 - d.getDay(),
                  };
                  if (e.key in offsets) {
                    e.preventDefault();
                    const next = new Date(d);
                    next.setDate(d.getDate() + offsets[e.key]);
                    setCursor(max && key(next) > max ? parse(max) : next);
                  }
                  if (e.key === "PageUp" || e.key === "PageDown") {
                    e.preventDefault();
                    moveMonth(
                      (e.key === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1),
                    );
                  }
                }}
              >
                {d.getDate()}
              </button>
            ))}
          </div>
          <div className="date-calendar-footer">
            <button type="button" onClick={() => choose("")}>
              Clear
            </button>
            <button type="button" onClick={() => choose(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
