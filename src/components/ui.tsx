import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconCheck, IconCopy, IconLoader } from "./icons";

/* Shared building blocks for the nearpool UI: flat surfaces with hairline
   borders, one radius scale, and a single primary action colour. */

export function Card({ className = "", children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-line bg-card ${className}`}>
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accentfill text-onaccent hover:brightness-95",
  secondary: "border border-line bg-card2 text-ink hover:border-faint",
  ghost: "text-muted hover:bg-card2 hover:text-ink",
  danger: "text-danger hover:bg-danger/10",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const sizing = size === "lg" ? "h-12 px-5 text-[15px]" : size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:bg-card2 disabled:text-faint disabled:brightness-100 ${sizing} ${VARIANT[variant]} ${className}`}
    >
      {loading && <IconLoader size={size === "sm" ? 12 : 15} className="shrink-0 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-card2 hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, className = "" }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate font-display text-lg font-semibold text-ink tabular">{value}</div>
      {sub !== undefined && <div className="mt-0.5 truncate text-xs text-faint tabular">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded-md bg-card2 ${className}`} />;
}

export function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  return (
    <IconButton
      label={copied ? "Copied" : "Copy"}
      className={`h-7 w-7 ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked — nothing to do */
        }
      }}
    >
      {copied ? <IconCheck size={13} className="text-accent" /> : <IconCopy size={13} />}
    </IconButton>
  );
}

/** Change in percent, coloured by sign. */
export function Delta({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-faint">—</span>;
  const tone = Math.abs(value) < 0.005 ? "text-muted" : value > 0 ? "text-accent" : "text-danger";
  return (
    <span className={`tabular ${tone}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Format a float price for display. Very small prices use the compact
 * zero-count notation common on DEXes: 0.0000004 → "0.0₆4".
 */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const exponent = Math.floor(Math.log10(n));
  const zeros = -exponent - 1;
  const digits = (n / 10 ** exponent).toFixed(3).replace(".", "").replace(/0+$/, "") || "0";
  if (zeros < 4) return `0.${"0".repeat(zeros)}${digits}`;
  return `0.0${String(zeros).split("").map((d) => SUBSCRIPT[Number(d)]).join("")}${digits}`;
}
