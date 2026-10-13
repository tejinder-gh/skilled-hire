"use client";

import { useEffect, useState } from "react";
import type {
  AlternativeSlot,
  SlotAvailabilityResponse,
} from "@marketplace/contracts";
import {
  Button,
  Card,
  Divider,
  Field,
  Grid,
  Metric,
  Shell,
  Status,
  Stepper,
} from "@marketplace/ui";
import { CANONICAL_TRADE_CATALOG } from "@marketplace/vertical-engine";

const requestSteps = [
  "Describe the issue",
  "Choose a time",
  "Confirm request",
] as const;
const timeline = [
  "Request received",
  "Appointment confirmed",
  "Technician assigned",
  "Assessment & quote",
  "Work & invoice",
] as const;

type DomainOption = {
  slug: string;
  label: string;
  icon: string;
  category: string;
  defaultIssue: string;
};

const domainIcons: Record<string, string> = {
  hvac: "❄️",
  plumbing: "🔧",
  electrical: "⚡",
  roofing: "🏠",
  "windows-doors": "🚪",
  carpentry: "🪚",
  "kitchen-bath": "🛁",
  "basement-finishing": "🪜",
  "structural-renovations": "🏗️",
  "side-entrances-walkouts": "🚪",
  "driveways-paving": "🚜",
  "interlocking-masonry": "🧱",
  landscaping: "🌱",
  cleaning: "✨",
  painting: "🎨",
  "pest-wildlife": "🦝",
  "appliance-repair": "⚙️",
  "security-smart-home": "📹",
  waterproofing: "🛡️",
  "moving-junk-removal": "🚛",
  "seasonal-services": "🍂",
};

const DOMAINS: DomainOption[] = CANONICAL_TRADE_CATALOG.map((v) => {
  const firstCat = v.categories[0];
  const firstVariant = firstCat?.variants[0];
  return {
    slug: v.slug,
    label: v.name,
    icon: domainIcons[v.slug] ?? "🔨",
    category: firstCat?.slug ?? "general",
    defaultIssue: firstVariant?.name ?? "General Diagnostic",
  };
});

type SlotOption = {
  id: string;
  label: string;
  day: string;
  time: string;
  peak: boolean;
};
const AVAILABLE_SLOTS: SlotOption[] = [
  {
    id: "today-13-15-surge",
    label: "Today · 1:00–3:00 PM (High Demand / Peak)",
    day: "Today",
    time: "1:00 PM – 3:00 PM",
    peak: true,
  },
  {
    id: "today-16-18-busy",
    label: "Today · 4:00–6:00 PM (Capacity Saturated)",
    day: "Today",
    time: "4:00 PM – 6:00 PM",
    peak: true,
  },
  {
    id: "tomorrow-09-11",
    label: "Tomorrow · 9:00–11:00 AM (Confirmed Open)",
    day: "Tomorrow",
    time: "9:00 AM – 11:00 AM",
    peak: false,
  },
  {
    id: "tomorrow-14-16",
    label: "Tomorrow · 2:00–4:00 PM (Confirmed Open)",
    day: "Tomorrow",
    time: "2:00 PM – 4:00 PM",
    peak: false,
  },
  {
    id: "friday-10-12",
    label: "Friday · 10:00 AM–12:00 PM (Off-Peak Open)",
    day: "Friday",
    time: "10:00 AM – 12:00 PM",
    peak: false,
  },
];

export default function CustomerHome() {
  const [mode, setMode] = useState<
    "home" | "request" | "busier-than-usual" | "submitted"
  >("home");
  const [step, setStep] = useState(0);
  const [selectedDomain, setSelectedDomain] = useState<string>("hvac");
  const [selectedSlot, setSelectedSlot] = useState<string>("today-13-15-surge");
  const [description, setDescription] = useState(
    "AC unit fan is running continuously but room temperature is not dropping.",
  );
  const [urgency, setUrgency] = useState<"STANDARD" | "EMERGENCY">("STANDARD");
  const [photo, setPhoto] = useState("");
  const [isStandbyQueue, setIsStandbyQueue] = useState<boolean>(false);
  const [smsAlerts, setSmsAlerts] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [liveRequestId, setLiveRequestId] = useState<string | null>(null);

  // Live availability data from backend API
  const [availabilityData, setAvailabilityData] =
    useState<SlotAvailabilityResponse | null>(null);
  const [checkingAvailability, setCheckingAvailability] =
    useState<boolean>(false);

  // Query slot availability on vertical or slot change
  useEffect(() => {
    async function queryAvailability() {
      setCheckingAvailability(true);
      try {
        const res = await fetch(
          `http://localhost:4000/v1/dispatch/slot-availability?vertical=${selectedDomain}&slot=${selectedSlot}`,
        );
        if (res.ok) {
          const data: SlotAvailabilityResponse = await res.json();
          setAvailabilityData(data);
          return;
        }
      } catch {
        // Fallback for offline mode
      } finally {
        setCheckingAvailability(false);
      }

      // Offline deterministic fallback
      const isBusy =
        selectedDomain !== "hvac" ||
        selectedSlot.includes("surge") ||
        selectedSlot.includes("busy");
      setAvailabilityData({
        verticalSlug: selectedDomain,
        verticalName:
          DOMAINS.find((d) => d.slug === selectedDomain)?.label ??
          selectedDomain.toUpperCase(),
        region: "ON",
        queriedSlot: selectedSlot,
        available: !isBusy,
        status: isBusy ? "BUSIER_THAN_USUAL" : "AVAILABLE",
        headline: isBusy
          ? `We're experiencing higher than usual demand for ${DOMAINS.find((d) => d.slug === selectedDomain)?.label} in Greater Toronto Area`
          : `Verified ${DOMAINS.find((d) => d.slug === selectedDomain)?.label} technicians ready for dispatch`,
        reason: isBusy
          ? `All licensed and verified specialists in this trade are currently committed on active calls in this time window.`
          : `Certified trade professionals have open capacity in this requested appointment window.`,
        metrics: {
          activeCertifiedTechnicians: selectedDomain === "hvac" ? 3 : 0,
          dispatchedCount: 3,
          capacitySaturationBps: isBusy ? 10000 : 3300,
          estimatedWaitMinutes: isBusy ? 120 : 0,
        },
        alternativeSlots: [
          {
            id: "tomorrow-09-11",
            label: "Tomorrow · 9:00–11:00 AM",
            day: "Tomorrow",
            time: "9:00 AM – 11:00 AM",
            guaranteed: true,
            demandLevel: "NORMAL",
            badge: "Recommended · 100% Guaranteed Arrival",
          },
          {
            id: "tomorrow-14-16",
            label: "Tomorrow · 2:00–4:00 PM",
            day: "Tomorrow",
            time: "2:00 PM – 4:00 PM",
            guaranteed: true,
            demandLevel: "NORMAL",
            badge: "Standard Service Window",
          },
          {
            id: "friday-10-12",
            label: "Friday · 10:00 AM–12:00 PM",
            day: "Friday",
            time: "10:00 AM – 12:00 PM",
            guaranteed: true,
            demandLevel: "LOW",
            badge: "Off-Peak Window · Best Availability",
          },
        ],
        emergencyOption: {
          available: true,
          title: "Request Emergency Priority Dispatch",
          badge: "⚡ Guaranteed 45-min on-call arrival",
          description:
            "Routes directly to on-call certified journeypersons reserved strictly for emergency response.",
          calloutFeeCents: 14900,
          slaMinutes: 45,
        },
        standbyWaitlist: {
          available: true,
          title: "Join Priority Standby Waitlist",
          badge: "⏱️ Automated dispatch on early finish",
          description:
            "Keep your desired time slot. If an existing job finishes early or an appointment reschedules, you are automatically assigned first in line.",
          queuePosition: 2,
          estimatedNoticeMinutes: 30,
        },
      });
    }
    queryAvailability();
  }, [selectedDomain, selectedSlot]);

  const activeDomainObj =
    DOMAINS.find((d) => d.slug === selectedDomain) ?? DOMAINS[0]!;
  const activeSlotObj =
    AVAILABLE_SLOTS.find((s) => s.id === selectedSlot) ?? AVAILABLE_SLOTS[0]!;
  const isCurrentlyBusy = availabilityData?.status === "BUSIER_THAN_USUAL";

  async function handleSubmitRequest() {
    if (submitting) return;
    setSubmitting(true);
    setSubmissionError(null);
    setLiveRequestId(null);
    try {
      if (process.env.NODE_ENV !== "development")
        throw new Error(
          "Booking requires a verified customer session. Please try again later.",
        );
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "customer@example.test",
          password: "DemoPassword!2026",
        }),
      });
      if (!loginRes.ok) throw new Error("Unable to authenticate.");
      {
        const { accessToken } = await loginRes.json();
        const [intakeRes, propRes] = await Promise.all([
          fetch(
            `http://localhost:4000/v1/verticals/${selectedDomain}/intake`,
          ).catch(() =>
            fetch("http://localhost:4000/v1/verticals/hvac/intake"),
          ),
          fetch("http://localhost:4000/v1/properties", {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        ]);
        if (!intakeRes.ok || !propRes.ok)
          throw new Error("Could not load service details.");
        {
          const { vertical, categories, issues } = await intakeRes.json();
          const properties = await propRes.json();
          const property = properties[0];
          const category = categories[0];
          const issue = issues[0];

          if (!property || !vertical || !category || !issue)
            throw new Error("Missing property or service details.");
          {
            const reqRes = await fetch(
              "http://localhost:4000/v1/service-requests",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  propertyId: property.id,
                  verticalId: vertical.id,
                  categoryId: category.id,
                  issueTypeId: issue.id,
                  urgency,
                  description:
                    description.trim() +
                    (isStandbyQueue
                      ? " [CUSTOMER ON PRIORITY STANDBY WAITLIST]"
                      : ""),
                  attachmentKeys: photo ? [photo] : [],
                }),
              },
            );
            if (!reqRes.ok)
              throw new Error("Request was not accepted. Please retry.");
            {
              const created = await reqRes.json();
              if (!created.id)
                throw new Error("Server did not confirm a request ID.");
              setLiveRequestId(created.id);
              setMode("submitted");
            }
          }
        }
      }
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : "Request failed. Please retry.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // --- VIEW: BUSIER THAN USUAL DEDICATED EXPERIENCE ---
  if (mode === "busier-than-usual") {
    return (
      <Shell
        title="We’re Busier Than Usual in Greater Toronto Area"
        subtitle="All certified trade specialists in this domain are currently committed on active dispatches. Skilled Hire enforces strict 100% regulatory verification—we never use unvetted filler contractors to mask capacity shortages."
        eyebrow="CAPACITY CONSTRAINED · VERIFIED TRADE NETWORK"
      >
        {/* Trade Domain Interactive Selector */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 20,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#52606d" }}>
            Queried Trade Domain:
          </span>
          {DOMAINS.map((domain) => (
            <Button
              key={domain.slug}
              variant={selectedDomain === domain.slug ? "primary" : "secondary"}
              onClick={() => setSelectedDomain(domain.slug)}
            >
              {domain.icon} {domain.label}
            </Button>
          ))}
        </div>

        {/* Hero Surge Advisory Card */}
        <Card tone="amber">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <Status tone="amber">
                  ⚡ High Demand Surge · Verified Capacity Constrained
                </Status>
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: "#52606d" }}
                >
                  Greater Toronto Area · Ontario
                </span>
              </div>
              <h2
                style={{
                  margin: "4px 0 8px",
                  fontSize: 26,
                  letterSpacing: "-0.01em",
                }}
              >
                {availabilityData?.headline ??
                  `Higher than usual demand for ${activeDomainObj.label}`}
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "#52606d",
                  fontSize: 15,
                  maxWidth: 760,
                  lineHeight: 1.5,
                }}
              >
                {availabilityData?.reason ??
                  `All licensed and verified specialists in this trade are currently committed on active dispatches.`}{" "}
                Because all Skilled Hire providers hold active TSSA, Skilled
                Trades Ontario, and statutory insurance compliance, we
                prioritize safety and workmanship over overbooked scheduling.
              </p>
            </div>
            <div style={{ textAlign: "right", minWidth: 150 }}>
              <span style={{ fontSize: 32, fontWeight: 900, color: "#9a6700" }}>
                100%
              </span>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#52606d",
                }}
              >
                Capacity Saturated
              </p>
            </div>
          </div>

          <Divider />

          {/* Operational Transparency Metrics */}
          <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
            <div>
              <Metric
                label="Active Dispatched Providers"
                value={`${availabilityData?.metrics?.activeCertifiedTechnicians ?? 3} / ${availabilityData?.metrics?.activeCertifiedTechnicians ?? 3} Active`}
                detail="100% of licensed field pros dispatched"
              />
            </div>
            <div>
              <Metric
                label="Requested Time Window"
                value={activeSlotObj.time}
                detail={`${activeSlotObj.day} · Peak volume window`}
              />
            </div>
            <div>
              <Metric
                label="Emergency Surge SLA"
                value="45 min"
                detail="Reserved on-call journeypersons"
              />
            </div>
            <div>
              <Metric
                label="Standby Early Dispatch"
                value="84%"
                detail="Assigned early within 45 minutes"
              />
            </div>
          </Grid>
        </Card>

        {/* Three Actionable Conversion Paths */}
        <h3 style={{ margin: "24px 0 12px", fontSize: 18 }}>
          Select your preferred resolution path:
        </h3>
        <Grid columns="repeat(auto-fit, minmax(320px, 1fr))">
          {/* Path 1: Next Available Confirmed Slot */}
          <Card tone="green">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <Status tone="green">Option 1 · Guaranteed Arrival</Status>
              <span style={{ fontSize: 20 }}>📅</span>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>
              Choose Next Confirmed Slot
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: "#52606d",
                lineHeight: 1.5,
              }}
            >
              Lock in the next confirmed service window with 100% arrival
              guarantee and no surge premium.
            </p>

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {(availabilityData?.alternativeSlots ?? []).map(
                (alt: AlternativeSlot) => (
                  <div
                    key={alt.id}
                    onClick={() => setSelectedSlot(alt.id)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border:
                        selectedSlot === alt.id
                          ? "2px solid #087f5b"
                          : "1px solid #d9e2ec",
                      background: selectedSlot === alt.id ? "#ecfdf5" : "#fff",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: "#172033",
                        }}
                      >
                        {alt.label}
                      </span>
                      <p
                        style={{
                          margin: "2px 0 0",
                          fontSize: 11,
                          color: "#087f5b",
                          fontWeight: 700,
                        }}
                      >
                        {alt.badge}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectedSlot === alt.id ? "#087f5b" : "#64748b",
                      }}
                    >
                      {selectedSlot === alt.id ? "✓ Selected" : "Select"}
                    </span>
                  </div>
                ),
              )}
            </div>

            <Button
              onClick={() => {
                setIsStandbyQueue(false);
                setMode("request");
                setStep(2);
              }}
            >
              Book Selected Slot &amp; Continue →
            </Button>
          </Card>

          {/* Path 2: On-Call Emergency Surge Dispatch */}
          <Card tone="blue">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <Status tone="blue">Option 2 · Urgent Safety</Status>
              <span style={{ fontSize: 20 }}>🚨</span>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>
              On-Call Emergency Dispatch
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: "#52606d",
                lineHeight: 1.5,
              }}
            >
              Experiencing an active hazard, severe water leak, or no heat in
              freezing temperatures? Routes immediately to our reserved on-call
              emergency crew.
            </p>

            <div
              style={{
                background: "#fff",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #bfdbfe",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: "#1e3a8a" }}
                >
                  Response SLA:
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 850, color: "#1d4ed8" }}
                >
                  Guaranteed 45 minutes
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: "#1e3a8a" }}
                >
                  Emergency Callout Fee:
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 850, color: "#1d4ed8" }}
                >
                  $149 CAD
                </span>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={() => {
                setUrgency("EMERGENCY");
                setIsStandbyQueue(false);
                setMode("request");
                setStep(2);
              }}
            >
              Request Emergency Dispatch ⚡
            </Button>
          </Card>

          {/* Path 3: Priority Standby Queue */}
          <Card>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <Status tone="amber">Option 3 · Keep Desired Window</Status>
              <span style={{ fontSize: 20 }}>⏱️</span>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>
              Join Priority Standby Queue
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: "#52606d",
                lineHeight: 1.5,
              }}
            >
              Keep your desired appointment time. If a preceding job completes
              ahead of schedule or another homeowner reschedules, you are
              assigned first.
            </p>

            <div
              style={{
                background: "#fffbeb",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #fde68a",
                marginBottom: 16,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#92400e",
                }}
              >
                Queue Position: #2 in Greater Toronto Area
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#78350f" }}>
                Average standby notification time: 32 minutes.
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#78350f",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={smsAlerts}
                  onChange={(e) => setSmsAlerts(e.target.checked)}
                />
                Send instant SMS alert when technician is en route
              </label>
            </div>

            <Button
              variant="secondary"
              onClick={() => {
                setIsStandbyQueue(true);
                setMode("request");
                setStep(2);
              }}
            >
              Lock In Priority Standby Placement ⏱️
            </Button>
          </Card>
        </Grid>

        {/* Footer Navigation */}
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Button
            variant="secondary"
            onClick={() => {
              setMode("request");
              setStep(1);
            }}
          >
            ← Back to Request Time Selection
          </Button>
          <Button variant="quiet" onClick={() => setMode("home")}>
            Return to Customer Portal Home
          </Button>
        </div>
      </Shell>
    );
  }

  // --- VIEW: SERVICE REQUEST WIZARD ---
  if (mode === "request") {
    return (
      <Shell
        title="Tell us what’s happening"
        subtitle="We’ll use this information to match the right verified professional and keep your quote transparent."
        eyebrow="NEW SERVICE REQUEST"
      >
        <Grid columns="minmax(0, 1.4fr) minmax(240px, .6fr)">
          <Card>
            <Stepper steps={requestSteps} current={step} />
            <Divider />

            {/* Step 0: Describe Issue & Select Domain */}
            {step === 0 && (
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    {DOMAINS.map((domain) => (
                      <button
                        key={domain.slug}
                        type="button"
                        onClick={() => {
                          setSelectedDomain(domain.slug);
                          setDescription(domain.defaultIssue);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border:
                            selectedDomain === domain.slug
                              ? "2px solid #1d4ed8"
                              : "1px solid #d9e2ec",
                          background:
                            selectedDomain === domain.slug ? "#eff6ff" : "#fff",
                          fontWeight: 750,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        {domain.icon} {domain.label}
                      </button>
                    ))}
                  </div>
                  <h2 style={{ marginBottom: 6 }}>
                    {activeDomainObj.label} Service Request
                  </h2>
                  <p style={{ color: "#52606d", marginTop: 0 }}>
                    My Home · 123 King Street W, Toronto
                  </p>
                </div>

                <Field
                  label="What are you noticing?"
                  value={description}
                  onChange={setDescription}
                  placeholder="For example: the system runs, but the air stays warm…"
                  multiline
                />
                <Field
                  label="Photo or video (optional)"
                  value={photo}
                  onChange={setPhoto}
                  placeholder="Paste a secure upload reference"
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button
                    variant={urgency === "STANDARD" ? "primary" : "secondary"}
                    onClick={() => setUrgency("STANDARD")}
                  >
                    Standard service
                  </Button>
                  <Button
                    variant={urgency === "EMERGENCY" ? "primary" : "secondary"}
                    onClick={() => setUrgency("EMERGENCY")}
                  >
                    Emergency service
                  </Button>
                </div>

                <Button
                  onClick={() => setStep(1)}
                  disabled={description.trim().length < 5}
                >
                  Continue
                </Button>
              </div>
            )}

            {/* Step 1: Choose Appointment Time & Capacity Check */}
            {step === 1 && (
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <Status tone="blue">{activeDomainObj.label}</Status>
                    <span
                      style={{
                        fontSize: 13,
                        color: "#52606d",
                        fontWeight: 700,
                      }}
                    >
                      Toronto Service Area
                    </span>
                  </div>
                  <h2 style={{ margin: 0 }}>Choose a convenient time</h2>
                  <p
                    style={{
                      color: "#52606d",
                      margin: "4px 0 0",
                      fontSize: 14,
                    }}
                  >
                    Real-time schedule check evaluates licensed technician
                    availability in your jurisdiction.
                  </p>
                </div>

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    color: "#52606d",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Preferred appointment window
                  <select
                    value={selectedSlot}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                    style={{
                      padding: 12,
                      borderRadius: 9,
                      border: "1px solid #d9e2ec",
                      font: "inherit",
                      background: "#fff",
                    }}
                  >
                    {AVAILABLE_SLOTS.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Capacity Status Card */}
                {checkingAvailability ? (
                  <Card tone="white">
                    <p style={{ margin: 0, fontSize: 13, color: "#52606d" }}>
                      ⏳ Checking certified technician capacity in Toronto…
                    </p>
                  </Card>
                ) : isCurrentlyBusy ? (
                  <Card tone="amber">
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ fontSize: 22 }}>⚡</span>
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <Status tone="amber">● Busier Than Usual</Status>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 750,
                              color: "#92400e",
                            }}
                          >
                            High Demand in this Time Slot
                          </span>
                        </div>
                        <h4 style={{ margin: "2px 0 6px", fontSize: 16 }}>
                          All verified {activeDomainObj.label} technicians are
                          booked for {activeSlotObj.day} {activeSlotObj.time}.
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            color: "#78350f",
                            fontSize: 13,
                            lineHeight: 1.5,
                          }}
                        >
                          Skilled Hire never dispatches unvetted contractors.
                          Choose next confirmed openings, on-call emergency
                          response, or lock in priority standby.
                        </p>
                        <div style={{ marginTop: 12 }}>
                          <Button
                            variant="primary"
                            onClick={() => setMode("busier-than-usual")}
                          >
                            View Busier Than Usual Options &amp; Alternatives →
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Card tone="green">
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <Status tone="green">● Confirmed Openings</Status>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 750,
                          color: "#087f5b",
                        }}
                      >
                        Verified {activeDomainObj.label} technicians have open
                        capacity for {activeSlotObj.label}.
                      </span>
                    </div>
                  </Card>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <Button variant="secondary" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  {isCurrentlyBusy ? (
                    <Button onClick={() => setMode("busier-than-usual")}>
                      Continue to Capacity Options
                    </Button>
                  ) : (
                    <Button onClick={() => setStep(2)}>Continue</Button>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Confirm Request */}
            {step === 2 && (
              <div style={{ display: "grid", gap: 16 }}>
                <Status tone="green">Ready to send</Status>
                <h2 style={{ margin: 0 }}>Review your request</h2>
                <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                  <strong>
                    {urgency === "EMERGENCY" ? "Emergency" : "Standard"} service
                  </strong>{" "}
                  for {activeDomainObj.label} ({description}) at My Home.
                </p>

                <div
                  style={{
                    background: "#f8fafc",
                    padding: 16,
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      Trade Domain:
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>
                      {activeDomainObj.icon} {activeDomainObj.label}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      Appointment Slot:
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>
                      {activeSlotObj.label}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      Dispatch Tier:
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color:
                          urgency === "EMERGENCY"
                            ? "#dc2626"
                            : isStandbyQueue
                              ? "#d97706"
                              : "#16a34a",
                      }}
                    >
                      {urgency === "EMERGENCY"
                        ? "⚡ Emergency Surge Dispatch (45-min SLA)"
                        : isStandbyQueue
                          ? "⏱️ Priority Standby Queue (#2 in line)"
                          : "✓ Confirmed Guaranteed Window"}
                    </span>
                  </div>
                </div>

                {submissionError && (
                  <p role="alert" style={{ color: "#b42318" }}>
                    {submissionError}
                  </p>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <Button
                    variant="secondary"
                    onClick={() => setStep(1)}
                    disabled={submitting}
                  >
                    Back
                  </Button>
                  <Button onClick={handleSubmitRequest} disabled={submitting}>
                    {submitting
                      ? "Transmitting to Dispatch..."
                      : "Submit service request"}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card tone="blue">
            <h3 style={{ marginTop: 0 }}>What happens next</h3>
            <Stepper
              steps={[
                "Operations reviews your request",
                "Eligible professionals are ranked",
                "You receive appointment updates",
              ]}
              current={step}
            />
            <Divider />
            <div style={{ fontSize: 12, color: "#52606d", lineHeight: 1.5 }}>
              🛡️ <strong>Skilled Hire Guarantee</strong>: Only 100% verified,
              statutory-compliant contractors are matched to your property.
            </div>
          </Card>
        </Grid>
      </Shell>
    );
  }

  // --- VIEW: SUBMITTED SUCCESS ---
  if (mode === "submitted" && liveRequestId) {
    return (
      <Shell
        title="Your request is in motion"
        subtitle="We’ll keep the next step clear and notify you when a verified professional is assigned."
      >
        <Card tone="green">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Status tone="green">Request received</Status>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#0b69a3" }}>
              {`Request #${liveRequestId.slice(0, 8).toUpperCase()}`}
            </span>
          </div>
          <h2>
            {activeDomainObj.label} — {description.slice(0, 50)}...
          </h2>
          <p style={{ color: "#52606d" }}>
            {urgency === "EMERGENCY" ? "Emergency" : "Standard"} service ·{" "}
            {activeSlotObj.label} · My Home · Toronto
          </p>
          {isStandbyQueue && (
            <div
              style={{
                background: "#fef3c7",
                padding: "8px 12px",
                borderRadius: 8,
                marginBottom: 14,
                color: "#92400e",
                fontSize: 13,
                fontWeight: 750,
              }}
            >
              Standby consideration requested; queue position is not confirmed.
            </div>
          )}
          <Button onClick={() => setMode("home")}>Back to home</Button>
        </Card>
        <Card>
          <h2 style={{ marginTop: 0 }}>Service timeline</h2>
          <Stepper steps={timeline} current={0} />
        </Card>
      </Shell>
    );
  }

  // --- VIEW: HOME SCREEN ---
  return (
    <Shell
      title="Skilled trade services, without the hassle."
      subtitle="One clear request. A verified, licensed professional. Transparent pricing. Powered by skilledhire.ca."
      eyebrow="SKILLED HIRE · CUSTOMER PORTAL"
    >
      {/* High Demand Advisory Banner */}
      <div style={{ marginBottom: 16 }}>
        <Card tone="amber">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 24 }}>⚡</span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Status tone="amber">● High Demand Advisory</Status>
                  <span
                    style={{ fontSize: 13, fontWeight: 750, color: "#52606d" }}
                  >
                    Greater Toronto Area
                  </span>
                </div>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#172033",
                  }}
                >
                  Trade capacity is currently busier than usual for peak
                  afternoon windows.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedDomain("hvac");
                setSelectedSlot("today-13-15-surge");
                setMode("busier-than-usual");
              }}
            >
              View Busier Than Usual Page &amp; Standby Options →
            </Button>
          </div>
        </Card>
      </div>

      <Grid columns="minmax(0, 1.4fr) minmax(260px, .6fr)">
        <Card tone="blue">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Status tone="blue">Verified Trades Available</Status>
            <span style={{ fontSize: 12, color: "#52606d", fontWeight: 700 }}>
              TSSA &amp; Skilled Trades Ontario
            </span>
          </div>
          <h2>What can we help with?</h2>
          <p style={{ color: "#52606d" }}>
            Start with a few details. Choose HVAC, Plumbing, Electrical, or
            Roofing. Photos and equipment details help match the right verified
            specialist faster.
          </p>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <Button
              onClick={() => {
                setMode("request");
                setStep(0);
              }}
            >
              Start a service request
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedDomain("plumbing");
                setSelectedSlot("today-13-15-surge");
                setMode("busier-than-usual");
              }}
            >
              Test Busier Than Usual (Plumbing)
            </Button>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>My home</h3>
          <p style={{ margin: "6px 0", fontWeight: 800 }}>123 King Street W</p>
          <p style={{ margin: 0, color: "#52606d" }}>
            Toronto, ON · 1 HVAC system
          </p>
          <Divider />
          <Button variant="quiet">View service history →</Button>
        </Card>
      </Grid>

      <Grid>
        <Card>
          <h2 style={{ marginTop: 0 }}>Your active service</h2>
          <Status tone="amber">No active request</Status>
          <p style={{ color: "#52606d" }}>
            Your requests, quotes, payments, invoices, warranties, and messages
            will appear here.
          </p>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Previous service</h2>
          <p style={{ margin: "6px 0", fontWeight: 800 }}>
            John S. · ABC Heating & Cooling
          </p>
          <p style={{ color: "#52606d" }}>
            AC tune-up · Completed Aug 2026 · ★ 4.9
          </p>
          <Button variant="secondary">Rebook this technician</Button>
        </Card>
      </Grid>
    </Shell>
  );
}
