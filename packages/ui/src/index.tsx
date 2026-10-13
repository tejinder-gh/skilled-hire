import type { PropsWithChildren, ReactNode } from "react";
import { useEffect, useState } from "react";

export const designTokens = {
  ink: "#0f172a",
  muted: "#475569",
  subtle: "#94a3b8",
  border: "#e2e8f0",
  blue: "#1d4ed8",
  blueHover: "#1e40af",
  blueWash: "#eff6ff",
  green: "#059669",
  greenWash: "#ecfdf5",
  amber: "#d97706",
  amberWash: "#fffbeb",
  danger: "#dc2626",
  dangerWash: "#fef2f2",
  purple: "#7c3aed",
  purpleWash: "#f5f3ff",
  wash: "#f8fafc",
  surface: "#ffffff",
  shadowSm: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
  shadowMd: "0 4px 12px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
  shadowLg: "0 12px 32px -4px rgb(15 23 42 / 0.1), 0 4px 12px -2px rgb(15 23 42 / 0.05)",
  radiusSm: 8,
  radiusMd: 14,
  radiusLg: 20,
  radiusXl: 24,
  radiusFull: 9999,
} as const;

const colors = designTokens;

export function Shell({
  title,
  subtitle,
  children,
  eyebrow = "SKILLED HIRE",
}: PropsWithChildren<{ title: string; subtitle: string; eyebrow?: string }>) {
  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "24px clamp(16px, 4vw, 48px) 80px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', ui-sans-serif, system-ui",
        color: colors.ink,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <header style={{ paddingBottom: 24, marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
            paddingBottom: 16,
            borderBottom: `1px solid ${colors.border}`,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: colors.blue,
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontWeight: 900,
                fontSize: 16,
                letterSpacing: "-0.02em",
                boxShadow: "0 4px 12px rgba(29, 78, 216, 0.28)",
              }}
            >
              SH
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 17,
                    letterSpacing: "-0.02em",
                    color: colors.ink,
                  }}
                >
                  Skilled Hire
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.blue,
                    background: colors.blueWash,
                    padding: "2px 8px",
                    borderRadius: colors.radiusFull,
                    border: "1px solid #bfdbfe",
                  }}
                >
                  skilledhire.ca
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: colors.muted,
                  fontWeight: 500,
                }}
              >
                Ontario Licensed & Statutory Trade Platform
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{ fontSize: 12, color: colors.muted, fontWeight: 600 }}
            >
              TSSA & Skilled Trades Ontario Verified
            </span>
            <Status tone="green">Platform Online</Status>
          </div>
        </div>

        <div>
          <p
            style={{
              color: colors.blue,
              fontWeight: 800,
              letterSpacing: ".08em",
              fontSize: 11,
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            {eyebrow}
          </p>
          <h1
            style={{
              fontSize: "clamp(28px, 4.4vw, 48px)",
              lineHeight: 1.12,
              letterSpacing: "-0.035em",
              fontWeight: 800,
              margin: "10px 0 12px",
              color: colors.ink,
            }}
          >
            {title}
          </h1>
          <p
            style={{
              color: colors.muted,
              fontSize: "clamp(15px, 1.8vw, 17px)",
              margin: 0,
              maxWidth: 760,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        </div>
      </header>

      {children}

      <footer
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: `1px solid ${colors.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          color: colors.muted,
          fontSize: 12,
        }}
      >
        <div>
          <strong style={{ color: colors.ink }}>Skilled Hire</strong> ·{" "}
          <span style={{ color: colors.blue }}>skilledhire.ca</span> · 100%
          Statutory Compliance & Workmanship Guarantee
        </div>
        <div>
          Licensed trade qualifications confirmed for each booking · No unvetted
          filler contractors
        </div>
      </footer>
    </main>
  );
}

export function Card({
  children,
  tone = "white",
  padding = "md",
  hoverable = false,
  onClick,
}: PropsWithChildren<{
  tone?: "white" | "blue" | "green" | "amber" | "danger" | "purple";
  padding?: "sm" | "md" | "lg";
  hoverable?: boolean;
  onClick?: () => void;
}>) {
  const background =
    tone === "blue"
      ? colors.blueWash
      : tone === "green"
        ? colors.greenWash
        : tone === "amber"
          ? colors.amberWash
          : tone === "danger"
            ? colors.dangerWash
            : tone === "purple"
              ? colors.purpleWash
              : colors.surface;

  const border =
    tone === "blue"
      ? "#bfdbfe"
      : tone === "green"
        ? "#a7f3d0"
        : tone === "amber"
          ? "#fde68a"
          : tone === "danger"
            ? "#fecaca"
            : tone === "purple"
              ? "#ddd6fe"
              : colors.border;

  const pad =
    padding === "sm"
      ? "14px 18px"
      : padding === "lg"
        ? "clamp(22px, 3.5vw, 36px)"
        : "clamp(18px, 2.8vw, 26px)";

  return (
    <section
      onClick={onClick}
      style={{
        border: `1px solid ${border}`,
        borderRadius: colors.radiusXl,
        padding: pad,
        marginBottom: 18,
        background,
        boxShadow: colors.shadowMd,
        cursor: onClick ? "pointer" : "default",
        transition:
          "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </section>
  );
}

export function Status({
  children,
  tone = "green",
}: PropsWithChildren<{
  tone?: "green" | "blue" | "amber" | "neutral" | "danger" | "purple";
}>) {
  const palette =
    tone === "blue"
      ? [colors.blueWash, colors.blue, "#bfdbfe"]
      : tone === "amber"
        ? [colors.amberWash, colors.amber, "#fde68a"]
        : tone === "neutral"
          ? ["#f1f5f9", colors.muted, colors.border]
          : tone === "danger"
            ? [colors.dangerWash, colors.danger, "#fecaca"]
            : tone === "purple"
              ? [colors.purpleWash, colors.purple, "#ddd6fe"]
              : [colors.greenWash, colors.green, "#a7f3d0"];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: palette[0],
        color: palette[1],
        border: `1px solid ${palette[2]}`,
        padding: "4px 10px",
        borderRadius: colors.radiusFull,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: palette[1],
        }}
      />
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{
  tone?: "blue" | "green" | "amber" | "neutral" | "danger" | "purple";
}>) {
  return <Status tone={tone}>{children}</Status>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  fullWidth = false,
  ariaLabel,
}: PropsWithChildren<{
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  ariaLabel?: string;
}>) {
  const styles =
    variant === "primary"
      ? {
          background: colors.blue,
          color: "#fff",
          border: `1px solid ${colors.blue}`,
          boxShadow: "0 2px 8px rgba(29, 78, 216, 0.25)",
        }
      : variant === "danger"
        ? {
            background: colors.danger,
            color: "#fff",
            border: `1px solid ${colors.danger}`,
            boxShadow: "0 2px 8px rgba(220, 38, 38, 0.25)",
          }
        : variant === "success"
          ? {
              background: colors.green,
              color: "#fff",
              border: `1px solid ${colors.green}`,
              boxShadow: "0 2px 8px rgba(5, 150, 105, 0.25)",
            }
          : variant === "secondary"
            ? {
                background: colors.surface,
                color: colors.ink,
                border: `1px solid ${colors.border}`,
                boxShadow: colors.shadowSm,
              }
            : {
                background: "transparent",
                color: colors.blue,
                border: "1px solid transparent",
              };

  const paddingHeight =
    size === "sm"
      ? { padding: "8px 14px", minHeight: 38, fontSize: 13 }
      : size === "lg"
        ? { padding: "16px 28px", minHeight: 52, fontSize: 16 }
        : { padding: "12px 20px", minHeight: 46, fontSize: 14 };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        ...styles,
        ...paddingHeight,
        borderRadius: colors.radiusMd,
        fontWeight: 700,
        width: fullWidth ? "100%" : "auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        touchAction: "manipulation",
        transition: "all 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  error,
  hint,
  id,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  multiline?: boolean | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  id?: string | undefined;
  type?: string | undefined;
}) {
  const shared = {
    width: "100%",
    boxSizing: "border-box" as const,
    border: `1px solid ${error ? colors.danger : colors.border}`,
    borderRadius: colors.radiusMd,
    padding: "13px 16px",
    minHeight: 46,
    font: "inherit",
    fontSize: 14,
    color: colors.ink,
    background: colors.surface,
    transition: "border-color 0.16s ease, box-shadow 0.16s ease",
  };

  return (
    <label
      htmlFor={id}
      style={{
        display: "grid",
        gap: 6,
        color: colors.muted,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={shared}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={shared}
        />
      )}
      {hint && !error && (
        <span style={{ fontSize: 12, fontWeight: 500, color: colors.subtle }}>
          {hint}
        </span>
      )}
      {error && (
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.danger }}>
          {error}
        </span>
      )}
    </label>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <p style={{ margin: 0, color: colors.muted, fontSize: 12, fontWeight: 700 }}>
        {label}
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          color: colors.ink,
        }}
      >
        {value}
      </p>
      {detail && (
        <p
          style={{
            margin: "3px 0 0",
            color: colors.muted,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {detail}
        </p>
      )}
    </div>
  );
}

export function Grid({
  children,
  columns = "repeat(auto-fit, minmax(220px, 1fr))",
}: PropsWithChildren<{ columns?: string }>) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: columns, gap: 16 }}>
      {children}
    </div>
  );
}

export function Stepper({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <nav aria-label="Progress" style={{ display: "grid", gap: 10 }}>
      {steps.map((step, index) => {
        const isCompleted = index < current;
        const isCurrent = index === current;
        return (
          <div
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: isCompleted || isCurrent ? colors.ink : colors.muted,
              fontWeight: isCurrent ? 800 : isCompleted ? 650 : 500,
              fontSize: 14,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background: isCompleted
                  ? colors.greenWash
                  : isCurrent
                    ? colors.blueWash
                    : colors.wash,
                color: isCompleted
                  ? colors.green
                  : isCurrent
                    ? colors.blue
                    : colors.muted,
                border: `1.5px solid ${isCompleted ? colors.green : isCurrent ? colors.blue : colors.border}`,
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {isCompleted ? "✓" : index + 1}
            </span>
            <span>{step}</span>
          </div>
        );
      })}
    </nav>
  );
}

export function Divider() {
  return (
    <hr
      style={{
        border: 0,
        borderTop: `1px solid ${colors.border}`,
        margin: "20px 0",
      }}
    />
  );
}

/* =========================================================================
   Apple HIG & Emil Kowalski Interactive Components
   ========================================================================= */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "View switcher",
}: {
  options: Array<{
    value: T;
    label: string;
    icon?: string | undefined;
    badge?: string | number | undefined;
  }>;
  value: T;
  onChange: (val: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        background: "#e2e8f0",
        padding: 4,
        borderRadius: colors.radiusMd,
        gap: 3,
        maxWidth: "100%",
        overflowX: "auto",
        boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.06)",
      }}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={isSelected}
            onClick={() => onChange(option.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: colors.radiusSm + 2,
              border: "none",
              background: isSelected ? colors.surface : "transparent",
              color: isSelected ? colors.ink : colors.muted,
              fontWeight: isSelected ? 750 : 600,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: isSelected
                ? "0 2px 6px rgba(15, 23, 42, 0.1), 0 1px 2px rgba(15, 23, 42, 0.06)"
                : "none",
              transition: "all 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
              whiteSpace: "nowrap",
            }}
          >
            {option.icon && <span>{option.icon}</span>}
            <span>{option.label}</span>
            {option.badge !== undefined && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: colors.radiusFull,
                  background: isSelected ? colors.blueWash : "#cbd5e1",
                  color: isSelected ? colors.blue : colors.ink,
                }}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StarRating({
  value,
  onChange,
  size = 28,
  readOnly = false,
  label = "Rate your experience",
}: {
  value: number;
  onChange?: (val: number) => void;
  size?: number;
  readOnly?: boolean;
  label?: string;
}) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const displayValue = hoverValue !== null ? hoverValue : value;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const isFilled = star <= displayValue;
        return (
          <button
            key={star}
            role="radio"
            type="button"
            aria-checked={value === star}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            disabled={readOnly}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => !readOnly && setHoverValue(star)}
            onMouseLeave={() => !readOnly && setHoverValue(null)}
            style={{
              background: "transparent",
              border: "none",
              padding: 4,
              cursor: readOnly ? "default" : "pointer",
              fontSize: size,
              lineHeight: 1,
              color: isFilled ? "#f59e0b" : "#cbd5e1",
              transform:
                hoverValue === star ? "scale(1.15)" : "scale(1)",
              transition: "transform 0.12s ease, color 0.12s ease",
            }}
          >
            ★
          </button>
        );
      })}
      {value > 0 && (
        <span
          style={{
            marginLeft: 8,
            fontSize: 13,
            fontWeight: 700,
            color: colors.ink,
          }}
        >
          {value} / 5
        </span>
      )}
    </div>
  );
}

export function NpsScale({
  value,
  onChange,
  label = "How likely are you to recommend Skilled Hire?",
}: {
  value: number | null;
  onChange: (score: number) => void;
  label?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: colors.muted }}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(11, 1fr)",
          gap: 4,
          maxWidth: 620,
        }}
      >
        {Array.from({ length: 11 }, (_, i) => i).map((score) => {
          const isSelected = value === score;
          const isDetractor = score <= 6;
          const isPassive = score === 7 || score === 8;
          const isPromoter = score >= 9;

          const activeColor = isPromoter
            ? colors.green
            : isPassive
              ? colors.blue
              : colors.amber;

          return (
            <button
              key={score}
              role="radio"
              type="button"
              aria-checked={isSelected}
              aria-label={`Score ${score}`}
              onClick={() => onChange(score)}
              style={{
                aspectRatio: "1",
                minHeight: 38,
                borderRadius: colors.radiusSm,
                border: `1.5px solid ${isSelected ? activeColor : colors.border}`,
                background: isSelected ? activeColor : colors.surface,
                color: isSelected ? "#fff" : colors.ink,
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.14s ease",
                display: "grid",
                placeItems: "center",
              }}
            >
              {score}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          fontWeight: 600,
          color: colors.subtle,
          maxWidth: 620,
        }}
      >
        <span>0 = Not likely at all</span>
        <span>10 = Extremely likely</span>
      </div>
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon,
}: PropsWithChildren<{
  tone?: "info" | "success" | "warning" | "danger";
  title: string;
  icon?: string;
}>) {
  const cfg =
    tone === "success"
      ? { bg: colors.greenWash, border: "#a7f3d0", color: colors.green, icon: icon ?? "✓" }
      : tone === "warning"
        ? { bg: colors.amberWash, border: "#fde68a", color: colors.amber, icon: icon ?? "⚠️" }
        : tone === "danger"
          ? { bg: colors.dangerWash, border: "#fecaca", color: colors.danger, icon: icon ?? "🛑" }
          : { bg: colors.blueWash, border: "#bfdbfe", color: colors.blue, icon: icon ?? "ℹ️" };

  return (
    <aside
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: colors.radiusMd,
        padding: "14px 18px",
        marginBottom: 16,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          fontSize: 18,
          lineHeight: 1,
          marginTop: 2,
        }}
      >
        {cfg.icon}
      </div>
      <div style={{ flex: 1 }}>
        <h4
          style={{
            margin: "0 0 4px",
            fontSize: 14,
            fontWeight: 800,
            color: colors.ink,
          }}
        >
          {title}
        </h4>
        <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
          {children}
        </div>
      </div>
    </aside>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "blue",
}: {
  value: number;
  max?: number;
  label?: string;
  tone?: "blue" | "green" | "amber";
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor =
    tone === "green"
      ? colors.green
      : tone === "amber"
        ? colors.amber
        : colors.blue;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {label && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            fontWeight: 700,
            color: colors.muted,
          }}
        >
          <span>{label}</span>
          <span>{Math.round(percent)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        style={{
          width: "100%",
          height: 8,
          backgroundColor: "#e2e8f0",
          borderRadius: colors.radiusFull,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: barColor,
            borderRadius: colors.radiusFull,
            transition: "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        border: `1.5px dashed ${colors.border}`,
        borderRadius: colors.radiusXl,
        background: colors.wash,
        display: "grid",
        placeItems: "center",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 36, lineHeight: 1 }}>{icon}</div>
      <h3
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 800,
          color: colors.ink,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: colors.muted,
          maxWidth: 420,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {action && (
        <div style={{ marginTop: 8 }}>
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search services, trades, repairs...",
  onClear,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onClear?: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: "100%",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 16,
          fontSize: 16,
          color: colors.muted,
          pointerEvents: "none",
        }}
      >
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "13px 40px 13px 44px",
          borderRadius: colors.radiusFull,
          border: `1.5px solid ${colors.border}`,
          background: colors.surface,
          fontSize: 14,
          fontFamily: "inherit",
          color: colors.ink,
          outline: "none",
          boxShadow: colors.shadowSm,
          transition: "border-color 0.16s ease, box-shadow 0.16s ease",
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            onClear?.();
          }}
          aria-label="Clear search"
          style={{
            position: "absolute",
            right: 14,
            background: "#e2e8f0",
            border: "none",
            borderRadius: "50%",
            width: 20,
            height: 20,
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            color: colors.muted,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
}: PropsWithChildren<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
}>) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: colors.radiusXl,
          border: `1px solid ${colors.border}`,
          boxShadow: colors.shadowLg,
          maxWidth: 620,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "clamp(20px, 3.5vw, 32px)",
          animation: "modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
            paddingBottom: 12,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: colors.ink,
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: "#f1f5f9",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              color: colors.muted,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
