import { DatePicker } from "./DatePicker";
import { Button } from "./ui";

export function ReportControls({
  frequency,
  date,
  disabled,
  generating,
  onFrequency,
  onDate,
  onGenerate,
}: {
  frequency: "weekly" | "monthly";
  date: string;
  disabled: boolean;
  generating: boolean;
  onFrequency: (frequency: "weekly" | "monthly") => void;
  onDate: (date: string) => void;
  onGenerate: () => void;
}) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const selected = new Date(`${date || today}T12:00:00`);
  const start = new Date(selected),
    end = new Date(selected);
  if (frequency === "weekly") start.setDate(start.getDate() - 6);
  else {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  }
  const format = (value: Date) =>
    value.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return (
    <div className="report-period-controls">
      <div className="report-controls">
        <label>
          Report frequency
          <select
            aria-label="Report frequency"
            disabled={disabled}
            value={frequency}
            onChange={(e) =>
              onFrequency(e.target.value as "weekly" | "monthly")
            }
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <DatePicker
          label="Reporting date"
          value={date}
          onChange={onDate}
          disabled={disabled}
          max={today}
          placeholder="Today"
        />
        <Button disabled={disabled} onClick={onGenerate}>
          {generating ? "Generating..." : "Generate report"}
        </Button>
      </div>
      <p className="report-period-preview" aria-live="polite">
        {format(start)} – {format(end)}
        <span>
          {frequency === "weekly"
            ? "Seven days ending on the reporting date."
            : "Calendar month containing the reporting date."}{" "}
          {!date && "Uses today in your timezone."}
        </span>
      </p>
    </div>
  );
}
