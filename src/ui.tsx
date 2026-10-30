import { useEffect, useRef, type ReactNode } from "react";
import { ReceiptText, X } from "lucide-react";
import { currencies, type Currency } from "../shared/money";
export const date = (v: string) =>
  new Date(v).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const time = (v: string) => new Date(v).toLocaleString();
export const field = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) || "");

export function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={secondary ? "button secondary" : "button"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <ReceiptText size={26} />
      <p>{children}</p>
    </div>
  );
}

export function CurrencySelect({
  name = "currency",
  value,
  onChange,
}: {
  name?: string;
  value?: Currency;
  onChange?: (c: Currency) => void;
}) {
  return (
    <select
      name={name}
      aria-label={name}
      value={value}
      onChange={(e) => onChange?.(e.target.value as Currency)}
    >
      {currencies.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

export function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}

export function PanelHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Integration({ name, text }: { name: string; text: string }) {
  return (
    <div>
      <strong>{name}</strong>
      <p>{text}</p>
    </div>
  );
}

export type Runner = (
  work: () => Promise<unknown>,
  message?: string,
) => Promise<boolean>;
