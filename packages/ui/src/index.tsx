import type { PropsWithChildren } from "react";
export const designTokens = { ink: "#172033", muted: "#52606d", border: "#d9e2ec", blue: "#1d4ed8", green: "#087f5b", wash: "#f8fafc", amber: "#9a6700" } as const;
const colors = designTokens;
export function Shell({ title, subtitle, children, eyebrow = "SKILLED HIRE" }: PropsWithChildren<{ title: string; subtitle: string; eyebrow?: string }>) {
  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "28px clamp(18px, 4vw, 52px) 72px", fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui", color: colors.ink }}>
      <header style={{ paddingBottom: 30, marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, paddingBottom: 16, borderBottom: "1px solid rgba(17,24,39,.07)", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "#1d4ed8", display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 16, letterSpacing: "-0.02em", boxShadow: "0 2px 6px rgba(29, 78, 216, 0.3)" }}>
              SH
            </div>
            <div>
              <span style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-0.01em", color: "#0f172a" }}>Skilled Hire</span>
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 650, color: "#2563eb", background: "#eff6ff", padding: "2px 7px", borderRadius: 6, border: "1px solid #bfdbfe" }}>
                skilledhire.ca
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: colors.muted, fontWeight: 600 }}>Ontario service marketplace</span>
            <Status tone="neutral">Service platform</Status>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p style={{ color: "#2563eb", fontWeight: 800, letterSpacing: ".08em", fontSize: 12, margin: 0 }}>{eyebrow}</p>
            <h1 style={{ fontSize: "clamp(32px, 4.8vw, 54px)", lineHeight: 1.08, letterSpacing: "-0.04em", fontWeight: 780, margin: "12px 0 14px" }}>{title}</h1>
            <p style={{ color: colors.muted, margin: 0, maxWidth: 700 }}>{subtitle}</p>
          </div>
        </div>
      </header>
      {children}
      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, color: colors.muted, fontSize: 12 }}>
        <div>
          <strong style={{ color: colors.ink }}>Skilled Hire</strong> · <span style={{ color: colors.blue }}>skilledhire.ca</span> · Home services made simpler
        </div>
        <div>
          Availability and professional eligibility are confirmed per request
        </div>
      </footer>
    </main>
  );
}
export function Card({ children, tone = "white" }: PropsWithChildren<{ tone?: "white" | "blue" | "green" | "amber" }>) { const background = tone === "blue" ? "#eff6ff" : tone === "green" ? "#ecfdf5" : tone === "amber" ? "#fffbeb" : "#fff"; return <section style={{ border: `1px solid ${colors.border}`, borderRadius: 24, padding: "clamp(18px, 3vw, 28px)", marginBottom: 18, background, boxShadow: "0 12px 32px rgb(15 23 42 / 4%), 0 1px 2px rgb(15 23 42 / 3%)" }}>{children}</section>; }
export function Status({ children, tone = "green" }: PropsWithChildren<{ tone?: "green" | "blue" | "amber" | "neutral" }>) { const palette = tone === "blue" ? ["#eff6ff", colors.blue] : tone === "amber" ? ["#fffbeb", colors.amber] : tone === "neutral" ? ["#f1f5f9", colors.muted] : ["#e6fcf5", colors.green]; return <span style={{ display: "inline-block", background: palette[0], color: palette[1], padding: "5px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{children}</span>; }
export function Button({ children, onClick, variant = "primary", type = "button", disabled = false }: PropsWithChildren<{ onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; type?: "button" | "submit"; disabled?: boolean }>) { const styles = variant === "primary" ? { background: colors.blue, color: "#fff", border: `1px solid ${colors.blue}` } : variant === "secondary" ? { background: "#fff", color: colors.ink, border: `1px solid ${colors.border}` } : { background: "transparent", color: colors.blue, border: "1px solid transparent" }; return <button type={type} onClick={onClick} disabled={disabled} style={{ ...styles, borderRadius: 14, padding: "13px 20px", minHeight: 48, fontWeight: 720, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .55 : 1 }}>{children}</button>; }
export function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) { const shared = { width: "100%", boxSizing: "border-box" as const, border: `1px solid ${colors.border}`, borderRadius: 13, padding: "14px 16px", minHeight: 48, font: "inherit", color: colors.ink, background: "#fff" }; return <label style={{ display: "grid", gap: 6, color: colors.muted, fontSize: 13, fontWeight: 700 }}>{label}{multiline ? <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={shared} /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={shared} />}</label>; }
export function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><p style={{ margin: 0, color: colors.muted, fontSize: 12, fontWeight: 700 }}>{label}</p><p style={{ margin: "4px 0 0", fontSize: 25, fontWeight: 850 }}>{value}</p>{detail && <p style={{ margin: "3px 0 0", color: colors.muted, fontSize: 12 }}>{detail}</p>}</div>; }
export function Grid({ children, columns = "repeat(auto-fit, minmax(220px, 1fr))" }: PropsWithChildren<{ columns?: string }>) { return <div style={{ display: "grid", gridTemplateColumns: columns, gap: 16 }}>{children}</div>; }
export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) { return <nav aria-label="Progress" style={{ display: "grid", gap: 8 }}>{steps.map((step, index) => <div key={step} aria-current={index === current ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: 10, color: index <= current ? colors.ink : colors.muted, fontWeight: index === current ? 850 : 650 }}><span style={{ width: 23, height: 23, display: "grid", placeItems: "center", borderRadius: "50%", background: index < current ? "#dcfce7" : index === current ? "#dbeafe" : "#f1f5f9", color: index < current ? colors.green : index === current ? colors.blue : colors.muted, fontSize: 12 }}>{index < current ? "✓" : index + 1}</span>{step}</div>)}</nav>; }
export function Divider() { return <hr style={{ border: 0, borderTop: `1px solid ${colors.border}`, margin: "18px 0" }} />; }
