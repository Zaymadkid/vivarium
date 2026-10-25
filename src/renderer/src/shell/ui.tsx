import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

export function LoadingRows({ n = 3, label = "Loading" }: { n?: number; label?: string }) {
  return (
    <div className="loadingrows" role="status" aria-label={label}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="loadline" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

export function Empty({
  icon = "box",
  title,
  body,
  action,
  tight,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={`empty ${tight ? "tight" : ""}`}>
      <span className="empty-icon">
        <Icon name={icon} size={tight ? 18 : 22} />
      </span>
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
  detail,
}: {
  message: string;
  onRetry?: () => void;
  detail?: string;
}) {
  return (
    <div className="errorblock" role="alert">
      <span className="errorblock-icon">
        <Icon name="warn" size={15} />
      </span>
      <div className="errorblock-main">
        <p>{message}</p>
        {detail && <code>{detail}</code>}
      </div>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Screen({
  title,
  subtitle,
  actions,
  children,
  tabs,
  dense,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tabs?: ReactNode;
  dense?: boolean;
}) {
  return (
    <section className={`screen ${dense ? "dense" : ""}`} aria-label={title}>
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">{title}</h1>
          {subtitle && <p className="screen-sub">{subtitle}</p>}
        </div>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      {tabs}
      <div className="screen-body">{children}</div>
    </section>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {right && <span className="section-label-right">{right}</span>}
    </div>
  );
}

export function Row({
  label,
  help,
  children,
  disabled,
  wide,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`row ${disabled ? "is-disabled" : ""} ${wide ? "wide" : ""}`}>
      <div className="row-main">
        <span className="row-label">{label}</span>
        {help && <span className="row-help">{help}</span>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Field({
  label,
  help,
  hint,
  children,
  error,
}: {
  label: string;
  help?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : help ? <span className="field-help">{help}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  mono,
  onEnter,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number" | "email" | "url";
  disabled?: boolean;
  mono?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      className={`input ${mono ? "mono" : ""}`}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  mono,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <textarea
      className={`input textarea ${mono ? "mono" : ""}`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      className="select"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function Range({
  value,
  onChange,
  min,
  max,
  step,
  format,
  disabled,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span className="range-wrap">
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b className="range-value">{format ? format(value) : value}</b>
    </span>
  );
}

export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; blurb: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <div className="radio-cards" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled || o.disabled}
          className={`radio-card ${value === o.value ? "on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          <span className="radio-title">{o.label}</span>
          <span className="radio-blurb">{o.blurb}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({
  tone = "idle",
  children,
  dot,
}: {
  tone?: "idle" | "live" | "warn" | "bad" | "warm" | "cool";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`chip ${tone}`}>
      {dot && <i className="chip-dot" />}
      {children}
    </span>
  );
}

export function Dot({ tone = "idle", pulse }: { tone?: "idle" | "live" | "warn" | "bad" | "warm"; pulse?: boolean }) {
  return <i className={`dot ${tone} ${pulse ? "pulse" : ""}`} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function ProgressRule({ value, tone = "warm" }: { value: number; tone?: "warm" | "live" | "bad" }) {
  return (
    <span className="progress-rule" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i className={tone} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 384,
  label,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  label?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal aria-label={label ?? title} style={{ width, maxWidth: "92vw" }}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
    </Modal>
  );
}

export function useOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onOutside();
    };
    window.addEventListener("mousedown", fn);
    return () => window.removeEventListener("mousedown", fn);
  }, [onOutside]);
  return ref;
}

export function Menu({
  children,
  onClose,
  align = "right",
  width,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  align?: "left" | "right";
  width?: number;
  className?: string;
}) {
  const ref = useOutside(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={`menu ${align === "left" ? "left" : ""} ${className ?? ""}`}
      style={width ? ({ width } as CSSProperties) : undefined}
      role="menu"
    >
      {children}
    </div>
  );
}

export function MenuRow({
  icon,
  children,
  onClick,
  hint,
  active,
  disabled,
  danger,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  hint?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`menu-row ${active ? "on" : ""} ${danger ? "danger" : ""}`}
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={14} />}
      <span className="menu-row-main">{children}</span>
      {hint && <span className="menu-row-hint">{hint}</span>}
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copyfield">
      <code>{value}</code>
      <button
        className="btn sm ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : (label ?? "Copy")}
      </button>
    </span>
  );
}

