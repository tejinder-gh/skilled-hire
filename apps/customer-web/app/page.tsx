"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AlternativeSlot,
  SlotAvailabilityResponse,
} from "@marketplace/contracts";
import {
  Badge,
  Button,
  Callout,
  Card,
  Divider,
  EmptyState,
  Field,
  Grid,
  Metric,
  Modal,
  NpsScale,
  ProgressBar,
  SearchBar,
  SegmentedControl,
  Shell,
  StarRating,
  Status,
  Stepper,
} from "@marketplace/ui";
import { CANONICAL_TRADE_CATALOG } from "@marketplace/vertical-engine";

const bookingSteps = [
  "Select Service",
  "Describe Issue",
  "Choose Time",
  "Confirm Booking",
] as const;

const liveJobSteps = [
  "Request Submitted",
  "Technician Assigned",
  "En Route (ETA)",
  "On-Site Diagnostic",
  "Work Completed",
] as const;

type DomainOption = {
  slug: string;
  label: string;
  icon: string;
  family: string;
  category: string;
  defaultIssue: string;
  basePriceCents: number;
  requiresPermit: boolean;
  permitAuthority?: string | undefined;
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
    family: v.family,
    category: firstCat?.slug ?? "general",
    defaultIssue: firstVariant?.name ?? "General Diagnostic Assessment",
    basePriceCents: firstVariant?.basePriceCents ?? 12900,
    requiresPermit: firstVariant?.requiresPermit ?? false,
    permitAuthority: v.permitAuthority ?? undefined,
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
    id: "today-13-15",
    label: "Today · 1:00–3:00 PM (Verified Open Capacity)",
    day: "Today",
    time: "1:00 PM – 3:00 PM",
    peak: false,
  },
  {
    id: "today-16-18",
    label: "Today · 4:00–6:00 PM (Standard Arrival Window)",
    day: "Today",
    time: "4:00 PM – 6:00 PM",
    peak: false,
  },
  {
    id: "tomorrow-09-11",
    label: "Tomorrow · 9:00–11:00 AM (Recommended Morning)",
    day: "Tomorrow",
    time: "9:00 AM – 11:00 AM",
    peak: false,
  },
  {
    id: "tomorrow-14-16",
    label: "Tomorrow · 2:00–4:00 PM (Afternoon Window)",
    day: "Tomorrow",
    time: "2:00 PM – 4:00 PM",
    peak: false,
  },
];

export default function CustomerHome() {
  const [activeTab, setActiveTab] = useState<
    "book" | "tracking" | "completion" | "warranty" | "survey"
  >("book");

  // --- SERVICE DIRECTORY & SEARCH ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFamily, setSelectedFamily] = useState<string>("ALL");
  const [selectedDomain, setSelectedDomain] = useState<string>("hvac");
  const [bookingStep, setBookingStep] = useState(0);

  // --- BOOKING FORM & ESTIMATE ---
  const [selectedSlot, setSelectedSlot] = useState<string>("today-13-15");
  const [description, setDescription] = useState(
    "Central AC compressor humming loudly, but condenser fan not turning and indoor air is warm.",
  );
  const [urgency, setUrgency] = useState<"STANDARD" | "EMERGENCY">("STANDARD");
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);

  // --- LIVE JOB TRACKING STATE ---
  const [liveJobStep, setLiveJobStep] = useState(2); // 2 = En Route
  const [etaMinutes, setEtaMinutes] = useState(18);

  // --- COMPLETION REPORT STATE ---
  const [completionApproved, setCompletionApproved] = useState(false);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  // --- WARRANTY & PASSPORT STATE ---
  const [claimDrawerOpen, setClaimDrawerOpen] = useState(false);
  const [claimDesc, setClaimDesc] = useState("");
  const [claimSeverity, setClaimSeverity] = useState<"LOW" | "MODERATE" | "HIGH">("MODERATE");
  const [activeClaimSubmitted, setActiveClaimSubmitted] = useState(false);

  // --- POST-JOB SURVEY & REWARD STATE ---
  const [starRating, setStarRating] = useState(5);
  const [npsScore, setNpsScore] = useState<number | null>(9);
  const [aspectRatings, setAspectRatings] = useState({
    punctuality: true,
    cleanliness: true,
    communication: true,
    quality: true,
  });
  const [surveyNotes, setSurveyNotes] = useState(
    "Technician Marcus arrived in 20 minutes, identified the faulty run capacitor immediately, and replaced it cleanly. Excellent service!",
  );
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [creditBalanceCents, setCreditBalanceCents] = useState(3000); // $30 CAD reward

  // Service Filtering
  const filteredDomains = useMemo(() => {
    return DOMAINS.filter((d) => {
      const matchesSearch =
        d.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.defaultIssue.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.slug.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFamily =
        selectedFamily === "ALL" || d.family === selectedFamily;
      return matchesSearch && matchesFamily;
    });
  }, [searchQuery, selectedFamily]);

  const activeDomainObj =
    DOMAINS.find((d) => d.slug === selectedDomain) ?? DOMAINS[0]!;

  // Dynamic estimate calculations
  const diagnosticFeeCents = activeDomainObj.basePriceCents;
  const estimatedLaborCents = 9500;
  const estimatedPartsCents = 5500;
  const platformFeeCents = 1800;
  const insuranceFeeCents = includeInsurance ? 1900 : 0;
  const totalEstimateCents =
    diagnosticFeeCents +
    estimatedLaborCents +
    estimatedPartsCents +
    platformFeeCents +
    insuranceFeeCents;

  const handleConfirmBooking = () => {
    setBookingConfirmed(true);
    setBookingStep(3);
    setActiveTab("tracking");
  };

  const handleSurveySubmit = () => {
    setSurveySubmitted(true);
    setCreditBalanceCents(3000);
  };

  return (
    <Shell
      title="Homeowner Service & Protection Hub"
      subtitle="Apple-inspired home care journey: instant trade search, transparent upfront estimates, live technician arrival tracking, structured sign-offs, 365-day workmanship warranty, and Digital Property Passport."
      eyebrow="SKILLED HIRE · ONTARIO LICENSED SERVICES"
    >
      {/* Primary Apple-style Navigation */}
      <div style={{ marginBottom: 24, overflowX: "auto" }}>
        <SegmentedControl
          ariaLabel="Homeowner navigation"
          value={activeTab}
          onChange={(tab) => setActiveTab(tab)}
          options={[
            {
              value: "book",
              label: "Book a Service",
              icon: "🔍",
              badge: bookingConfirmed ? "Active" : undefined,
            },
            {
              value: "tracking",
              label: "Live Job Tracking",
              icon: "🚗",
              badge: `${etaMinutes}m ETA`,
            },
            {
              value: "completion",
              label: "Completion & Sign-off",
              icon: "📝",
              badge: completionApproved ? "Signed" : "Pending",
            },
            {
              value: "warranty",
              label: "Warranty & Passport",
              icon: "🛡️",
              badge: "365-Day",
            },
            {
              value: "survey",
              label: "Survey & $30 Reward",
              icon: "🎁",
              badge: `$${(creditBalanceCents / 100).toFixed(0)}`,
            },
          ]}
        />
      </div>

      {/* -------------------------------------------------------------
          TAB 1: BOOK A SERVICE & TRANSPARENT ESTIMATE
         ------------------------------------------------------------- */}
      {activeTab === "book" && (
        <div>
          {/* Stepper Header */}
          <div style={{ marginBottom: 20 }}>
            <Stepper steps={bookingSteps} current={bookingStep} />
          </div>

          {bookingStep === 0 && (
            <Card tone="white" padding="lg">
              <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>
                Find a Licensed Ontario Trade Specialist
              </h2>
              <p style={{ margin: "0 0 20px", color: "#475569", fontSize: 14 }}>
                100% verified tradespeople. All appointments backed by the Skilled Hire
                Workmanship Guarantee and statutory regulatory compliance (TSSA, ESA, Skilled
                Trades Ontario).
              </p>

              {/* Search Bar */}
              <div style={{ marginBottom: 18 }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search by trade (e.g. AC repair, electrical panel, plumbing, heat pump)..."
                />
              </div>

              {/* Family Filters */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 20,
                  flexWrap: "wrap",
                }}
              >
                {[
                  { id: "ALL", label: "All 21 Trades" },
                  { id: "MECHANICAL", label: "Mechanical & HVAC" },
                  { id: "STRUCTURAL", label: "Structural & Framing" },
                  { id: "BUILDING_ENVELOPE", label: "Roofing & Windows" },
                  { id: "RENOVATION", label: "Renovation" },
                  { id: "PROPERTY_MAINTENANCE", label: "Maintenance" },
                ].map((fam) => (
                  <button
                    key={fam.id}
                    type="button"
                    onClick={() => setSelectedFamily(fam.id)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      border: "none",
                      background: selectedFamily === fam.id ? "#1d4ed8" : "#f1f5f9",
                      color: selectedFamily === fam.id ? "#fff" : "#475569",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.14s ease",
                    }}
                  >
                    {fam.label}
                  </button>
                ))}
              </div>

              {/* Services Grid */}
              <Grid columns="repeat(auto-fill, minmax(260px, 1fr))">
                {filteredDomains.map((dom) => {
                  const isSelected = selectedDomain === dom.slug;
                  return (
                    <div
                      key={dom.slug}
                      onClick={() => {
                        setSelectedDomain(dom.slug);
                        setBookingStep(1);
                      }}
                      style={{
                        border: `1.5px solid ${isSelected ? "#1d4ed8" : "#e2e8f0"}`,
                        borderRadius: 18,
                        padding: 18,
                        background: isSelected ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
                        transition:
                          "transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.16s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <span style={{ fontSize: 28 }}>{dom.icon}</span>
                        {dom.requiresPermit && (
                          <Badge tone="amber">
                            {dom.permitAuthority ? `${dom.permitAuthority} Permit` : "Permit Req."}
                          </Badge>
                        )}
                      </div>
                      <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800 }}>
                        {dom.label}
                      </h3>
                      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                        {dom.defaultIssue}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          paddingTop: 10,
                          borderTop: "1px solid #f1f5f9",
                        }}
                      >
                        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                          Diagnostic from:
                        </span>
                        <strong style={{ fontSize: 14, color: "#1d4ed8" }}>
                          ${(dom.basePriceCents / 100).toFixed(0)} CAD
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </Grid>
            </Card>
          )}

          {bookingStep === 1 && (
            <Card tone="white" padding="lg">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <Badge tone="blue">Selected Trade</Badge>
                  <h2 style={{ fontSize: 24, margin: "6px 0 2px" }}>
                    {activeDomainObj.icon} {activeDomainObj.label} Diagnostic Request
                  </h2>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setBookingStep(0)}>
                  Change Trade
                </Button>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <Field
                  label="Describe the issue you are experiencing"
                  multiline
                  value={description}
                  onChange={setDescription}
                  placeholder="What are the symptoms? When did it start? Any error codes on thermostat/equipment?"
                />

                <div style={{ display: "grid", gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                    Service Urgency
                  </label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button
                      variant={urgency === "STANDARD" ? "primary" : "secondary"}
                      onClick={() => setUrgency("STANDARD")}
                    >
                      Standard Appointment (Scheduled)
                    </Button>
                    <Button
                      variant={urgency === "EMERGENCY" ? "danger" : "secondary"}
                      onClick={() => setUrgency("EMERGENCY")}
                    >
                      ⚡ Emergency Priority (Guaranteed 45-min on-call)
                    </Button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                  <Button variant="primary" size="lg" onClick={() => setBookingStep(2)}>
                    Continue to Slot Selection →
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {bookingStep === 2 && (
            <div style={{ display: "grid", gap: 20 }}>
              {/* Appointment Slot Selector */}
              <Card tone="white" padding="lg">
                <h2 style={{ fontSize: 22, margin: "0 0 6px" }}>
                  Select Arrival Window · Toronto (Greater Area)
                </h2>
                <p style={{ margin: "0 0 16px", color: "#475569", fontSize: 14 }}>
                  All slots are backed by confirmed journeyperson availability. No overbooking.
                </p>

                <div style={{ display: "grid", gap: 10 }}>
                  {AVAILABLE_SLOTS.map((slot) => {
                    const isSelected = selectedSlot === slot.id;
                    return (
                      <div
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot.id)}
                        style={{
                          border: `1.5px solid ${isSelected ? "#1d4ed8" : "#e2e8f0"}`,
                          borderRadius: 14,
                          padding: 16,
                          background: isSelected ? "#eff6ff" : "#fff",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          transition: "all 0.14s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 20 }}>🗓️</span>
                          <div>
                            <strong style={{ fontSize: 15, color: "#0f172a" }}>
                              {slot.label}
                            </strong>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                              {slot.day} · 2-Hour Arrival Window
                            </p>
                          </div>
                        </div>
                        <Status tone={isSelected ? "blue" : "neutral"}>
                          {isSelected ? "Selected Window" : "Available"}
                        </Status>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Transparent Rate Card & Job Estimate Breakdown */}
              <Card tone="blue" padding="lg">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <Status tone="blue">Transparent Estimate Breakdown</Status>
                    <h3 style={{ margin: "6px 0 2px", fontSize: 20, fontWeight: 800 }}>
                      No Hidden Surcharges · Skilled Hire Guarantee
                    </h3>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                      Estimated Total Range
                    </span>
                    <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#1d4ed8" }}>
                      ${(totalEstimateCents / 100).toFixed(2)}{" "}
                      <span style={{ fontSize: 14 }}>CAD</span>
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: 16,
                    border: "1px solid #bfdbfe",
                    display: "grid",
                    gap: 10,
                    fontSize: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>On-Site Diagnostic Assessment Fee (Credited towards repair)</span>
                    <strong>${(diagnosticFeeCents / 100).toFixed(2)} CAD</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Estimated Journeyperson Labor (Standard Diagnostic)</span>
                    <strong>${(estimatedLaborCents / 100).toFixed(2)} CAD</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Estimated Standard Replacement Parts (e.g. OEM Capacitor)</span>
                    <strong>${(estimatedPartsCents / 100).toFixed(2)} CAD</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Platform Service & Regulatory Verification Fee</span>
                    <strong>${(platformFeeCents / 100).toFixed(2)} CAD</strong>
                  </div>

                  <Divider />

                  {/* Customer Protection Insurance Toggle */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong style={{ color: "#0f172a" }}>
                        🛡️ Optional Customer Protection Insurance (+$19.00 CAD)
                      </strong>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                        Underwritten protection up to $10,000 for incidental property damage or
                        secondary system failures.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={includeInsurance}
                      onChange={(e) => setIncludeInsurance(e.target.checked)}
                      style={{ width: 20, height: 20, cursor: "pointer" }}
                    />
                  </div>
                </div>

                <Callout tone="info" title="Truthful Pricing Notice">
                  Diagnostic fee applies upon technician arrival. Final labor and parts estimate
                  is presented for your 1-click in-app approval before any physical repairs begin.
                </Callout>

                <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                  <Button variant="primary" size="lg" onClick={handleConfirmBooking}>
                    ✓ Confirm Booking & Dispatch Technician
                  </Button>
                  <Button variant="secondary" size="lg" onClick={() => setBookingStep(1)}>
                    Back
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 2: LIVE JOB TRACKING & ASSIGNMENT STATES
         ------------------------------------------------------------- */}
      {activeTab === "tracking" && (
        <div>
          <Card tone="white" padding="lg">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Status tone="blue">Technician En Route</Status>
                  <Badge tone="neutral">Booking #REQ-2026-9921</Badge>
                  <Badge tone="green">TSSA & ESA Verified</Badge>
                </div>
                <h2 style={{ fontSize: 26, margin: "8px 0 4px" }}>
                  Lennox AC Diagnostic & Repair
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  123 King Street W · Unit 1402 · Toronto, ON
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Estimated Arrival
                </span>
                <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#1d4ed8" }}>
                  {etaMinutes} min <span style={{ fontSize: 14 }}>ETA</span>
                </p>
              </div>
            </div>

            <div style={{ margin: "24px 0" }}>
              <Stepper steps={liveJobSteps} current={liveJobStep} />
            </div>

            <Divider />

            {/* Assigned Technician Profile Card */}
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 18,
                padding: 20,
                border: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "#dbeafe",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 24,
                    color: "#1d4ed8",
                    fontWeight: 800,
                  }}
                >
                  MS
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                    Marcus Sterling
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      margin: "4px 0 2px",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>
                      ★ 4.9 (124 jobs)
                    </span>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>·</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
                      Lead HVAC Journeyperson
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                    Verified Credentials: TSSA Gas G2 (#984210) · Skilled Trades 313A (#44912)
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => alert("Connecting secure encrypted phone bridge to technician Marcus...")}
                >
                  📞 Call Technician
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setLiveJobStep(4);
                    setActiveTab("completion");
                  }}
                >
                  Fast-Forward to Completion →
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 3: STRUCTURED JOB COMPLETION & SIGN-OFF
         ------------------------------------------------------------- */}
      {activeTab === "completion" && (
        <div>
          <Card tone="white" padding="lg">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <Status tone={completionApproved ? "green" : "amber"}>
                  {completionApproved
                    ? "✓ Completion Accepted & Approved"
                    : "Review & Sign-Off Pending"}
                </Status>
                <h2 style={{ fontSize: 24, margin: "6px 0 2px" }}>
                  Technician Work Completion Report
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  Submitted by Marcus Sterling (TSSA #984210) · Today at 11:15 AM
                </p>
              </div>
              <Badge tone="blue">Job #JOB-2026-4412</Badge>
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <Callout tone="info" title="Diagnostic Findings & Work Performed">
                &ldquo;Diagnosed failed dual-run capacitor causing condenser hard start. Replaced
                with new OEM Lennox 45/5 uF capacitor. Verified amp draw (2.8A fan / 14.1A compressor).
                Tested cooling delta T across evaporator coil: 18.5°F drop achieved. Condensate drain
                cleared.&rdquo;
              </Callout>

              {/* Before / After Evidence */}
              <div>
                <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>
                  Field Photographic Evidence
                </h3>
                <Grid columns="repeat(auto-fit, minmax(240px, 1fr))">
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 14,
                      background: "#fffbeb",
                    }}
                  >
                    <Badge tone="amber">BEFORE WORK</Badge>
                    <div
                      style={{
                        height: 110,
                        borderRadius: 10,
                        background: "#e2e8f0",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 28,
                        margin: "10px 0 6px",
                      }}
                    >
                      📷
                    </div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
                      Burned spade terminal & bulging run capacitor
                    </p>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 14,
                      background: "#ecfdf5",
                    }}
                  >
                    <Badge tone="green">AFTER WORK</Badge>
                    <div
                      style={{
                        height: 110,
                        borderRadius: 10,
                        background: "#e2e8f0",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 28,
                        margin: "10px 0 6px",
                      }}
                    >
                      📷
                    </div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
                      OEM capacitor installed, wiring insulated & secured
                    </p>
                  </div>
                </Grid>
              </div>

              {/* Parts Installed */}
              <div style={{ background: "#f8fafc", borderRadius: 14, padding: 16 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800 }}>
                  Installed Equipment & Parts (Logged to Passport)
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                  • Lennox Dual-Run Capacitor 45/5 uF 440V (Serial: `CAP-99412-OEM`)
                  <br />
                  • Associated Asset: Lennox Central AC Unit (Serial: `SN-8821940-2026`)
                </p>
              </div>

              {completionApproved ? (
                <Callout tone="success" title="Customer Acceptance Signed">
                  You approved this completion report. 365-Day Workmanship Warranty certificate
                  has been issued, and maintenance records have been written to your Property
                  Service Passport.
                </Callout>
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  <Button
                    variant="success"
                    size="lg"
                    onClick={() => {
                      setCompletionApproved(true);
                      setActiveTab("warranty");
                    }}
                  >
                    ✓ Accept & Sign-off Work Completion
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => setDisputeModalOpen(true)}
                  >
                    Report Discrepancy / Open Dispute
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Dispute Modal */}
          <Modal
            isOpen={disputeModalOpen}
            onClose={() => setDisputeModalOpen(false)}
            title="Report Workmanship Discrepancy"
          >
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0, fontSize: 14, color: "#475569" }}>
                If the work was incomplete or does not match the technician attestation, submit
                your feedback. Platform operations will review and hold the payout.
              </p>
              <Field
                label="Explain the discrepancy"
                multiline
                value={disputeReason}
                onChange={setDisputeReason}
                placeholder="Describe what is missing or unsatisfactory..."
              />
              <div style={{ display: "flex", gap: 10 }}>
                <Button
                  variant="danger"
                  disabled={!disputeReason.trim()}
                  onClick={() => {
                    alert("Discrepancy reported. Support ticket created.");
                    setDisputeModalOpen(false);
                  }}
                >
                  Submit Discrepancy Notice
                </Button>
                <Button variant="secondary" onClick={() => setDisputeModalOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 4: 365-DAY WORKMANSHIP WARRANTY & PROPERTY PASSPORT
         ------------------------------------------------------------- */}
      {activeTab === "warranty" && (
        <div style={{ display: "grid", gap: 24 }}>
          {/* Apple Wallet-style 365-Day Warranty Pass */}
          <div
            style={{
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
              color: "#fff",
              borderRadius: 24,
              padding: "clamp(24px, 4vw, 36px)",
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.25)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Subtle Metallic Accent */}
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 200,
                height: 200,
                background: "radial-gradient(circle, rgba(29, 78, 216, 0.25) 0%, transparent 70%)",
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: 16,
                marginBottom: 28,
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color: "#60a5fa",
                  }}
                >
                  SKILLED HIRE PLATFORM GUARANTEE
                </span>
                <h2 style={{ fontSize: 26, margin: "6px 0 0", color: "#fff", fontWeight: 800 }}>
                  365-Day Workmanship Warranty Pass
                </h2>
              </div>
              <div
                style={{
                  background: "rgba(5, 150, 105, 0.2)",
                  border: "1px solid #10b981",
                  color: "#34d399",
                  padding: "6px 14px",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                ✓ ACTIVE COVERAGE
              </div>
            </div>

            <Grid columns="repeat(auto-fit, minmax(180px, 1fr))">
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
                  Certificate / Policy #
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800 }}>
                  WAR-2026-9F8A1
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
                  Covered Equipment
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800 }}>
                  Lennox AC (SN-8821940)
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
                  Coverage Expiry
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#60a5fa" }}>
                  October 12, 2027
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
                  Statutory Provider
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800 }}>
                  Marcus S. (TSSA G2)
                </p>
              </div>
            </Grid>

            <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                onClick={() => setClaimDrawerOpen(true)}
              >
                🛡️ File a Warranty Claim
              </Button>
              <Button
                variant="secondary"
                onClick={() => alert("Digital Apple Wallet pass link dispatched to your device.")}
              >
                Add to Apple Wallet
              </Button>
            </div>
          </div>

          {/* Property Service Passport */}
          <Card tone="white" padding="lg">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <Status tone="blue">Digital Home Service Ledger</Status>
                <h3 style={{ margin: "6px 0 2px", fontSize: 22, fontWeight: 800 }}>
                  Property Service Passport
                </h3>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  123 King Street W · Toronto, ON · Verified Asset History
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => alert("Secure passport read-only link generated: https://skilledhire.ca/passport/123-king-st-w")}
              >
                🔗 Share / Export Passport
              </Button>
            </div>

            {/* Equipment Inventory Cards */}
            <h4 style={{ margin: "16px 0 10px", fontSize: 15, fontWeight: 800 }}>
              Registered Home Equipment Inventory
            </h4>

            <Grid columns="repeat(auto-fit, minmax(280px, 1fr))">
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <Badge tone="green">Healthy · Active Warranty</Badge>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Installed 2026</span>
                </div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Lennox High-Efficiency Central AC
                </h4>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
                  Model: XC21-036-230 · Serial: SN-8821940-2026
                </p>
                <div style={{ marginTop: 10, fontSize: 12, color: "#059669", fontWeight: 700 }}>
                  ✓ Last Serviced: Today (Capacitor replacement)
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <Badge tone="neutral">Standard Status</Badge>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Installed 2024</span>
                </div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Rinnai Tankless Water Heater
                </h4>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
                  Model: RU199iN · Serial: SN-4410291
                </p>
                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                  Scheduled Descale: March 2027
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <Badge tone="blue">ESA Certified</Badge>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Installed 2025</span>
                </div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Siemens 200A Electrical Service Panel
                </h4>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
                  Permit #ESA-2026-9912 · Certificate of Acceptance on File
                </p>
                <div style={{ marginTop: 10, fontSize: 12, color: "#1d4ed8", fontWeight: 700 }}>
                  ✓ Passed Electrical Safety Authority Inspection
                </div>
              </div>
            </Grid>
          </Card>

          {/* Warranty Claim Modal */}
          <Modal
            isOpen={claimDrawerOpen}
            onClose={() => setClaimDrawerOpen(false)}
            title="File a 365-Day Workmanship Warranty Claim"
          >
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0, fontSize: 14, color: "#475569" }}>
                Under your Skilled Hire Workmanship Guarantee (Policy WAR-2026-9F8A1), any defect in
                materials or labor is covered at 100% platform expense.
              </p>
              <Field
                label="Describe the issue with the completed repair"
                multiline
                value={claimDesc}
                onChange={setClaimDesc}
                placeholder="e.g. Condensate pipe is leaking, or strange sound from capacitor..."
              />
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  Severity Level
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["LOW", "MODERATE", "HIGH"] as const).map((sev) => (
                    <Button
                      key={sev}
                      variant={claimSeverity === sev ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setClaimSeverity(sev)}
                    >
                      {sev} Priority
                    </Button>
                  ))}
                </div>
              </div>

              {activeClaimSubmitted ? (
                <Callout tone="success" title="Warranty Claim Triaged">
                  Claim submitted. Contractor right-to-cure window activated (48-hour response).
                  Zero charge guaranteed.
                </Callout>
              ) : (
                <Button
                  variant="primary"
                  disabled={!claimDesc.trim()}
                  onClick={() => {
                    setActiveClaimSubmitted(true);
                    setTimeout(() => setClaimDrawerOpen(false), 2000);
                  }}
                >
                  Submit Warranty Claim
                </Button>
              )}
            </div>
          </Modal>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 5: POST-JOB SURVEY & FTC-COMPLIANT $30 REWARD
         ------------------------------------------------------------- */}
      {activeTab === "survey" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Unconditional Reward Credit Banner */}
          <Card tone="green" padding="lg">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              <div>
                <Status tone="green">Un-Gated 10% Next-Booking Credit</Status>
                <h2 style={{ fontSize: 24, margin: "6px 0 2px" }}>
                  Your Feedback Reward: $30.00 CAD
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  In compliance with FTC and Competition Bureau Canada rules, this credit is awarded
                  unconditionally for your honest review, regardless of whether your rating is 1 or
                  5 stars.
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                  Customer Wallet Balance
                </span>
                <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#059669" }}>
                  ${(creditBalanceCents / 100).toFixed(2)}{" "}
                  <span style={{ fontSize: 14 }}>CAD</span>
                </p>
              </div>
            </div>
          </Card>

          {/* Survey Card */}
          <Card tone="white" padding="lg">
            <h3 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 800 }}>
              Rate Your Service Experience with Marcus Sterling
            </h3>

            <div style={{ display: "grid", gap: 20 }}>
              {/* Star Rating */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Overall Star Rating
                </label>
                <StarRating value={starRating} onChange={setStarRating} size={32} />
              </div>

              {/* NPS Score */}
              <div>
                <NpsScale value={npsScore} onChange={setNpsScore} />
              </div>

              {/* Aspect Toggles */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Service Standards Met
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { key: "punctuality", label: "⏰ Arrived on Time" },
                    { key: "cleanliness", label: "🧹 Clean Work Area" },
                    { key: "communication", label: "💬 Clear Communication" },
                    { key: "quality", label: "🔧 High Craftsmanship Quality" },
                  ].map((aspect) => {
                    const isChecked =
                      aspectRatings[aspect.key as keyof typeof aspectRatings];
                    return (
                      <button
                        key={aspect.key}
                        type="button"
                        onClick={() =>
                          setAspectRatings((prev) => ({
                            ...prev,
                            [aspect.key]: !isChecked,
                          }))
                        }
                        style={{
                          padding: "8px 14px",
                          borderRadius: 9999,
                          border: `1.5px solid ${isChecked ? "#059669" : "#e2e8f0"}`,
                          background: isChecked ? "#ecfdf5" : "#fff",
                          color: isChecked ? "#065f46" : "#64748b",
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: "pointer",
                          transition: "all 0.14s ease",
                        }}
                      >
                        {aspect.label} {isChecked ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Freeform Review */}
              <Field
                label="Detailed Feedback (Optional)"
                multiline
                value={surveyNotes}
                onChange={setSurveyNotes}
                placeholder="Share specifics about the diagnosis, explanation, and results..."
              />

              {surveySubmitted ? (
                <Callout tone="success" title="Review & Reward Confirmed!">
                  Thank you! Your review is published. Your $30.00 CAD credit voucher code is{" "}
                  <strong>SKILLED-REWARD-10</strong>, automatically applied to your next booking.
                </Callout>
              ) : (
                <div>
                  <Button variant="primary" size="lg" onClick={handleSurveySubmit}>
                    Submit Honest Review & Unlock $30 Credit
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
