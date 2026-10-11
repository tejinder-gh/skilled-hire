"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ComplianceEvaluationStatus,
  CredentialGroupCode,
  CredentialStatus,
  EntityLevel,
  SubmittedCredentialInput,
} from "@marketplace/contracts";
import {
  Button,
  Card,
  Divider,
  Grid,
  Metric,
  Shell,
  Status,
  Stepper,
} from "@marketplace/ui";
import {
  CANONICAL_TRADE_CATALOG,
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  filterComplianceStandards,
} from "@marketplace/vertical-engine";

const jobSteps = [
  "Assigned",
  "En route",
  "Arrived",
  "Assessment",
  "Quote",
  "Complete",
] as const;

type DomainOption = { slug: string; label: string; icon: string };

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

const DOMAINS: DomainOption[] = CANONICAL_TRADE_CATALOG.map((v) => ({
  slug: v.slug,
  label: v.name,
  icon: domainIcons[v.slug] ?? "🔨",
}));

type LocationOption = {
  code: string;
  label: string;
  country: string;
  flag: string;
};
const LOCATIONS: LocationOption[] = [
  {
    code: "ON",
    label: "Ontario (TSSA / Skilled Trades Ontario)",
    country: "Canada",
    flag: "🇨🇦",
  },
  {
    code: "BC",
    label: "British Columbia (Technical Safety BC)",
    country: "Canada",
    flag: "🇨🇦",
  },
  {
    code: "CA",
    label: "California (CSLB / Cal-OSHA)",
    country: "USA",
    flag: "🇺🇸",
  },
  { code: "TX", label: "Texas (TDLR / TSBPE)", country: "USA", flag: "🇺🇸" },
];

// Sample baseline credentials for demonstration
const INITIAL_DEMO_CREDENTIALS: Record<string, SubmittedCredentialInput> = {
  // Ontario baseline
  ON_TSSA_GAS_G2: {
    code: "ON_TSSA_GAS_G2",
    status: "VERIFIED",
    expiryDate: "2027-08-20",
    geography: "ON",
    licenseNumber: "G2-984210",
  },
  ON_SKILLED_TRADES_313A: {
    code: "ON_SKILLED_TRADES_313A",
    status: "VERIFIED",
    expiryDate: "2027-08-20",
    geography: "ON",
    licenseNumber: "313A-44912",
  },
  CA_ODS_REFRIGERANT: {
    code: "CA_ODS_REFRIGERANT",
    status: "VERIFIED",
    expiryDate: "2028-05-15",
    geography: "ON",
    licenseNumber: "ODS-88219",
  },
  ON_WSIB_CLEARANCE: {
    code: "ON_WSIB_CLEARANCE",
    status: "VERIFIED",
    expiryDate: "2027-06-30",
    geography: "ON",
    licenseNumber: "WSIB-99120",
  },
  ON_MOL_HEIGHTS: {
    code: "ON_MOL_HEIGHTS",
    status: "VERIFIED",
    expiryDate: "2027-09-10",
    geography: "ON",
    licenseNumber: "WAH-1039",
  },
  CGL_INSURANCE_2M: {
    code: "CGL_INSURANCE_2M",
    status: "VERIFIED",
    expiryDate: "2027-06-30",
    geography: "*",
    licenseNumber: "POL-7741029",
  },
  COMMERCIAL_AUTO_1M: {
    code: "COMMERCIAL_AUTO_1M",
    status: "VERIFIED",
    expiryDate: "2027-06-30",
    geography: "*",
    licenseNumber: "AUTO-9912",
  },
  GOVT_PHOTO_ID: { code: "GOVT_PHOTO_ID", status: "VERIFIED", geography: "*" },
  BACKGROUND_CHECK_ANNUAL: {
    code: "BACKGROUND_CHECK_ANNUAL",
    status: "VERIFIED",
    expiryDate: "2027-08-20",
    geography: "*",
  },
  FIRST_AID_CPR_C: {
    code: "FIRST_AID_CPR_C",
    status: "VERIFIED",
    expiryDate: "2027-11-01",
    geography: "*",
  },

  // California baseline
  CA_CSLB_C20: {
    code: "CA_CSLB_C20",
    status: "VERIFIED",
    expiryDate: "2027-10-15",
    geography: "CA",
    licenseNumber: "CSLB-1049281",
  },
  US_EPA_608_UNIVERSAL: {
    code: "US_EPA_608_UNIVERSAL",
    status: "VERIFIED",
    geography: "CA",
    licenseNumber: "EPA-UNIV-4921",
  },
  CA_CSLB_SURETY_BOND: {
    code: "CA_CSLB_SURETY_BOND",
    status: "VERIFIED",
    expiryDate: "2027-10-15",
    geography: "CA",
    licenseNumber: "BOND-25K-881",
  },
  CA_WORKERS_COMP: {
    code: "CA_WORKERS_COMP",
    status: "VERIFIED",
    expiryDate: "2027-10-15",
    geography: "CA",
    licenseNumber: "WC-CA-44102",
  },

  // Texas baseline
  TX_TDLR_ACR_CLASS_A: {
    code: "TX_TDLR_ACR_CLASS_A",
    status: "VERIFIED",
    expiryDate: "2027-04-12",
    geography: "TX",
    licenseNumber: "TACLA-88129",
  },
  TX_TDLR_INSURANCE: {
    code: "TX_TDLR_INSURANCE",
    status: "VERIFIED",
    expiryDate: "2027-04-12",
    geography: "TX",
    licenseNumber: "TDI-INS-551",
  },
};

export default function ContractorHome() {
  const [activeTab, setActiveTab] = useState<"workspace" | "compliance">(
    "compliance",
  );
  const [selectedVertical, setSelectedVertical] = useState("hvac");
  const [selectedLocation, setSelectedLocation] = useState("ON");
  const [selectedEntityLevel, setSelectedEntityLevel] = useState<
    EntityLevel | "ALL"
  >("ALL");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<
    CredentialGroupCode | "ALL"
  >("ALL");

  // Local state of submitted/held credentials so prospective providers can test their readiness
  const [userCredentials, setUserCredentials] = useState<
    Record<string, SubmittedCredentialInput>
  >(INITIAL_DEMO_CREDENTIALS);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(
    null,
  );

  // Job workboard state
  const [accepted, setAccepted] = useState(false);
  const [current, setCurrent] = useState(accepted ? 1 : 0);
  const step = accepted ? current : 0;

  // Filter applicable standards
  const applicableStandards = useMemo(() => {
    const entity =
      selectedEntityLevel === "ALL" ? undefined : selectedEntityLevel;
    return filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      selectedVertical,
      selectedLocation,
      entity,
    );
  }, [selectedVertical, selectedLocation, selectedEntityLevel]);

  // Evaluate real-time compliance scorecard
  const scorecard = useMemo(() => {
    const credsList = Object.values(userCredentials);
    const entity =
      selectedEntityLevel === "ALL" ? undefined : selectedEntityLevel;
    return evaluateCompliance(applicableStandards, credsList, {
      verticalSlug: selectedVertical,
      geography: selectedLocation,
      entityLevel: entity,
    });
  }, [
    applicableStandards,
    userCredentials,
    selectedVertical,
    selectedLocation,
    selectedEntityLevel,
  ]);

  // Group status helper
  const getStatusTone = (status: ComplianceEvaluationStatus) => {
    if (status === "VERIFIED") return "green";
    if (status === "PENDING_REVIEW") return "blue";
    if (status === "EXPIRED") return "amber";
    return "amber";
  };

  const toggleCredentialStatus = (
    credentialCode: string,
    standardGeography: string,
  ) => {
    setUserCredentials((prev) => {
      const currentVal = prev[credentialCode];
      if (!currentVal) {
        // Add as verified
        return {
          ...prev,
          [credentialCode]: {
            code: credentialCode,
            status: "VERIFIED",
            expiryDate: "2027-12-31",
            geography: standardGeography,
            licenseNumber: `LIC-${Math.floor(100000 + Math.random() * 900000)}`,
          },
        };
      }
      if (currentVal.status === "VERIFIED") {
        // Toggle to PENDING
        return {
          ...prev,
          [credentialCode]: { ...currentVal, status: "PENDING" },
        };
      }
      if (currentVal.status === "PENDING") {
        // Toggle to EXPIRED
        return {
          ...prev,
          [credentialCode]: {
            ...currentVal,
            status: "VERIFIED",
            expiryDate: "2024-01-01",
          },
        };
      }
      // Remove entirely (MISSING)
      const copy = { ...prev };
      delete copy[credentialCode];
      return copy;
    });
    setSubmissionFeedback(`Updated verification state for ${credentialCode}`);
    setTimeout(() => setSubmissionFeedback(null), 3000);
  };

  // Real-time job synchronization with live backend API
  const [liveJob, setLiveJob] = useState<{
    id: string;
    serviceRequestId: string;
    description: string;
    address: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    async function fetchContractorJobs() {
      try {
        const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "owner@example.test",
            password: "DemoPassword!2026",
          }),
        });
        if (loginRes.ok) {
          const { accessToken } = await loginRes.json();
          const jobsRes = await fetch("http://localhost:4000/v1/jobs", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (jobsRes.ok) {
            const jobs = await jobsRes.json();
            if (jobs.length > 0) {
              const j = jobs[0];
              setLiveJob({
                id: j.id,
                serviceRequestId: j.service_request_id,
                description:
                  j.request_description ?? "AC not cooling — Avery's Home",
                address: `${j.address_line1 ?? "123 King Street W"} · ${j.city ?? "Toronto"}`,
                status: j.status,
              });
              if (j.status !== "ASSIGNED") {
                setAccepted(true);
                const stepMap: Record<string, number> = {
                  ASSIGNED: 0,
                  TECHNICIAN_EN_ROUTE: 1,
                  TECHNICIAN_ARRIVED: 2,
                  ASSESSMENT_IN_PROGRESS: 3,
                  QUOTE_PENDING: 4,
                  WORK_IN_PROGRESS: 4,
                  COMPLETION_PENDING: 4,
                  COMPLETED: 5,
                };
                const mappedStep = stepMap[j.status];
                if (typeof mappedStep === "number") {
                  setCurrent(mappedStep);
                }
              }
            }
          }
        }
      } catch {
        // Fall back to offline demo state
      }
    }
    fetchContractorJobs();
  }, []);

  const handleAcceptJob = async () => {
    setAccepted(true);
    setCurrent(1);
    if (liveJob) {
      try {
        const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "owner@example.test",
            password: "DemoPassword!2026",
          }),
        });
        if (loginRes.ok) {
          const { accessToken } = await loginRes.json();
          await fetch(
            `http://localhost:4000/v1/service-requests/${liveJob.serviceRequestId}/transition`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ to: "TECHNICIAN_EN_ROUTE" }),
            },
          );
        }
      } catch {
        // Graceful offline fallback
      }
    }
  };

  const handleAdvanceJobStatus = async () => {
    const nextStep = Math.min(jobSteps.length - 1, current + 1);
    setCurrent(nextStep);
    if (liveJob) {
      const stepToTargetState: Record<number, string> = {
        1: "TECHNICIAN_EN_ROUTE",
        2: "TECHNICIAN_ARRIVED",
        3: "ASSESSMENT_IN_PROGRESS",
        4: "QUOTE_PENDING",
        5: "COMPLETED",
      };
      const targetState = stepToTargetState[nextStep];
      if (targetState) {
        try {
          const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "owner@example.test",
              password: "DemoPassword!2026",
            }),
          });
          if (loginRes.ok) {
            const { accessToken } = await loginRes.json();
            await fetch(
              `http://localhost:4000/v1/service-requests/${liveJob.serviceRequestId}/transition`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ to: targetState }),
              },
            );
          }
        } catch {
          // Graceful offline fallback
        }
      }
    }
  };

  const uploadSampleCredential = async (
    standardCode: string,
    standardName: string,
  ) => {
    setUserCredentials((prev) => ({
      ...prev,
      [standardCode]: {
        code: standardCode,
        status: "PENDING",
        geography: selectedLocation,
        documentKey: `uploads/${standardCode.toLowerCase()}-doc.pdf`,
        expiryDate: "2028-06-30",
        licenseNumber: `VER-${Date.now().toString().slice(-6)}`,
      },
    }));
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.test",
          password: "DemoPassword!2026",
        }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        await fetch("http://localhost:4000/v1/credentials/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            code: standardCode,
            geography: selectedLocation,
            documentKey: `uploads/${standardCode.toLowerCase()}-doc.pdf`,
            expiryDate: "2028-06-30",
            licenseNumber: `VER-${Date.now().toString().slice(-6)}`,
            entityType:
              selectedEntityLevel === "TECHNICIAN"
                ? "TECHNICIAN"
                : "CONTRACTOR",
          }),
        });
        setSubmissionFeedback(
          `Document submitted & saved to platform database for ${standardName}! Status: PENDING_REVIEW`,
        );
      } else {
        setSubmissionFeedback(
          `Document submitted for ${standardName}! Platform audit status: PENDING_REVIEW`,
        );
      }
    } catch {
      setSubmissionFeedback(
        `Document submitted for ${standardName}! Platform audit status: PENDING_REVIEW`,
      );
    }
    setTimeout(() => setSubmissionFeedback(null), 4000);
  };

  const selectedDomainObj = DOMAINS.find((d) => d.slug === selectedVertical);
  const selectedLocObj = LOCATIONS.find((l) => l.code === selectedLocation);

  const domainSelectId = useId();
  const locationSelectId = useId();
  const entitySelectId = useId();

  return (
    <Shell
      title="Contractor & Trade Partner Operations"
      subtitle="Manage field service dispatching and verify compliance against statutory government regulations across Canada & US on skilledhire.ca."
      eyebrow="SKILLED HIRE · SERVICE PROVIDER NETWORK"
    >
      {/* Top Navigation Tabs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Button
          variant={activeTab === "compliance" ? "primary" : "secondary"}
          onClick={() => setActiveTab("compliance")}
        >
          🛡️ Compliance & Standards Verification
        </Button>
        <Button
          variant={activeTab === "workspace" ? "primary" : "secondary"}
          onClick={() => setActiveTab("workspace")}
        >
          📋 Active Job Workboard
        </Button>
      </div>

      {activeTab === "compliance" ? (
        <>
          {/* Executive Compliance Scorecard Banner */}
          <Card
            tone={
              scorecard.overallStatus === "VERIFIED"
                ? "green"
                : scorecard.overallStatus === "PENDING_REVIEW"
                  ? "blue"
                  : "amber"
            }
          >
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
                    marginBottom: 6,
                  }}
                >
                  <Status tone={getStatusTone(scorecard.overallStatus)}>
                    {scorecard.overallStatus === "VERIFIED"
                      ? "● Fully Verified & Dispatch Ready"
                      : scorecard.overallStatus === "PENDING_REVIEW"
                        ? "● Documents In Verification Audit Queue"
                        : scorecard.overallStatus === "EXPIRED"
                          ? "▲ Action Required: Expired Mandatory Credential"
                          : "▲ Compliance Deficient: Mandatory Standards Missing"}
                  </Status>
                  <span
                    style={{ fontSize: 13, fontWeight: 700, color: "#52606d" }}
                  >
                    Standard: {selectedDomainObj?.label} in{" "}
                    {selectedLocObj?.label}
                  </span>
                </div>
                <h2
                  style={{
                    margin: "4px 0 6px",
                    fontSize: 24,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Provider Readiness Scorecard:{" "}
                  {Math.round(scorecard.scoreBps / 100)}%
                </h2>
                <p
                  style={{
                    margin: 0,
                    color: "#52606d",
                    fontSize: 14,
                    maxWidth: 680,
                  }}
                >
                  {scorecard.overallStatus === "VERIFIED"
                    ? "Congratulations! All statutory regulations, trade licenses, environmental mandates, and insurance bounds are fully verified. You are eligible for automated customer lead dispatch in this jurisdiction."
                    : scorecard.overallStatus === "PENDING_REVIEW"
                      ? "Credentials have been uploaded and are currently under secondary platform audit. Verification typically takes 2-4 business hours."
                      : "To provide field services in this jurisdiction, statutory regulations require active verification of all mandatory standards before customer jobs can be dispatched."}
                </p>
              </div>

              <div style={{ textAlign: "right", minWidth: 160 }}>
                <span
                  style={{ fontSize: 32, fontWeight: 900, color: "#172033" }}
                >
                  {scorecard.mandatoryPassed} / {scorecard.mandatoryTotal}
                </span>
                <p
                  style={{
                    margin: "2px 0 0",
                    color: "#52606d",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Mandatory Standards Met
                </p>
                <div
                  style={{
                    background: "#e2e8f0",
                    height: 8,
                    borderRadius: 999,
                    overflow: "hidden",
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${scorecard.mandatoryTotal > 0 ? (scorecard.mandatoryPassed / scorecard.mandatoryTotal) * 100 : 100}%`,
                      background:
                        scorecard.overallStatus === "VERIFIED"
                          ? "#087f5b"
                          : "#1d4ed8",
                      borderRadius: 999,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            </div>

            {submissionFeedback && (
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  background: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                🔔 {submissionFeedback}
              </div>
            )}
          </Card>

          {/* Standards Query & Configuration Filter Bar */}
          <Card>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
              🔍 Filter Standards by Domain & Jurisdiction
            </h3>
            <Grid columns="repeat(auto-fit, minmax(240px, 1fr))">
              <div>
                <label
                  htmlFor={domainSelectId}
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#52606d",
                    marginBottom: 6,
                  }}
                >
                  TRADE VERTICAL (DOMAIN)
                </label>
                <select
                  id={domainSelectId}
                  value={selectedVertical}
                  onChange={(e) => setSelectedVertical(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #d9e2ec",
                    fontWeight: 700,
                    color: "#172033",
                    background: "#fff",
                  }}
                >
                  {DOMAINS.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.icon} {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={locationSelectId}
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#52606d",
                    marginBottom: 6,
                  }}
                >
                  LOCATION / JURISDICTION
                </label>
                <select
                  id={locationSelectId}
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #d9e2ec",
                    fontWeight: 700,
                    color: "#172033",
                    background: "#fff",
                  }}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={entitySelectId}
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#52606d",
                    marginBottom: 6,
                  }}
                >
                  ENTITY SCOPE
                </label>
                <select
                  id={entitySelectId}
                  value={selectedEntityLevel}
                  onChange={(e) =>
                    setSelectedEntityLevel(e.target.value as any)
                  }
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #d9e2ec",
                    fontWeight: 700,
                    color: "#172033",
                    background: "#fff",
                  }}
                >
                  <option value="ALL">
                    All Entity Requirements (Contractor & Technician)
                  </option>
                  <option value="CONTRACTOR">
                    Contractor Business Entity Only
                  </option>
                  <option value="TECHNICIAN">
                    Individual Field Technician Only
                  </option>
                </select>
              </div>
            </Grid>
          </Card>

          {/* The 6 Canonical Regulatory Groups Carousel / Selector */}
          <div style={{ marginBottom: 18 }}>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                fontWeight: 800,
                color: "#52606d",
                letterSpacing: "0.06em",
              }}
            >
              REGULATORY COMPLIANCE PILLARS ({CREDENTIAL_GROUPS.length}{" "}
              STATUTORY GROUPS)
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 6,
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedGroupFilter("ALL")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${selectedGroupFilter === "ALL" ? "#1d4ed8" : "#cbd5e1"}`,
                  background:
                    selectedGroupFilter === "ALL" ? "#eff6ff" : "#fff",
                  color: selectedGroupFilter === "ALL" ? "#1d4ed8" : "#334155",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                All Groups ({applicableStandards.length} Standards)
              </button>
              {CREDENTIAL_GROUPS.map((group) => {
                const groupStandards = applicableStandards.filter(
                  (s) => s.groupCode === group.code,
                );
                const isSelected = selectedGroupFilter === group.code;
                return (
                  <button
                    key={group.code}
                    type="button"
                    onClick={() => setSelectedGroupFilter(group.code)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: `1px solid ${isSelected ? "#1d4ed8" : "#cbd5e1"}`,
                      background: isSelected ? "#eff6ff" : "#fff",
                      color: isSelected ? "#1d4ed8" : "#334155",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {group.name} ({groupStandards.length})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group Summaries & Interactive Standard Verification Cards */}
          {scorecard.groups
            .filter(
              (group) =>
                selectedGroupFilter === "ALL" ||
                group.groupCode === selectedGroupFilter,
            )
            .map((group) => (
              <Card key={group.groupCode}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: "0 0 4px",
                        fontSize: 18,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>{group.groupName}</span>
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#52606d" }}>
                      {
                        CREDENTIAL_GROUPS.find(
                          (g) => g.code === group.groupCode,
                        )?.description
                      }
                    </p>
                  </div>
                  <Status
                    tone={
                      group.status === "PASS"
                        ? "green"
                        : group.status === "PENDING"
                          ? "blue"
                          : "amber"
                    }
                  >
                    {group.status === "PASS"
                      ? "✓ Group Verified"
                      : group.status === "PENDING"
                        ? "⏳ Under Review"
                        : "▲ Incomplete"}
                  </Status>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {group.items.map((item) => {
                    const { standard, matchedCredential, status, reason } =
                      item;
                    const isPassed = status === "PASS";
                    const isPending = status === "FAIL_PENDING";
                    const isExpired = status === "FAIL_EXPIRED";
                    const isMissing = status === "FAIL_MISSING";

                    return (
                      <div
                        key={standard.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          padding: "14px 16px",
                          background: isPassed
                            ? "#f0fdf4"
                            : isPending
                              ? "#f0f9ff"
                              : isExpired
                                ? "#fffbeb"
                                : "#fff",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 16,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: "1 1 360px" }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: 15,
                                color: "#0f172a",
                              }}
                            >
                              {standard.name}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                padding: "2px 7px",
                                borderRadius: 4,
                                background:
                                  standard.requirementLevel === "MANDATORY"
                                    ? "#fee2e2"
                                    : "#f1f5f9",
                                color:
                                  standard.requirementLevel === "MANDATORY"
                                    ? "#991b1b"
                                    : "#475569",
                              }}
                            >
                              {standard.requirementLevel}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 4,
                                background: "#f1f5f9",
                                color: "#475569",
                              }}
                            >
                              {standard.entityLevel === "CONTRACTOR"
                                ? "🏢 Contractor Business"
                                : "👷 Field Tech"}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "#64748b",
                              }}
                            >
                              Code: {standard.credentialCode}
                            </span>
                          </div>

                          <p
                            style={{
                              margin: "2px 0 6px",
                              fontSize: 13,
                              color: "#475569",
                            }}
                          >
                            {standard.description}
                          </p>

                          <div
                            style={{
                              display: "flex",
                              gap: 14,
                              fontSize: 12,
                              color: "#64748b",
                              flexWrap: "wrap",
                            }}
                          >
                            <span>
                              🏛️ Authority:{" "}
                              <strong>{standard.issuingAuthority}</strong>
                            </span>
                            {standard.legalReference && (
                              <span>
                                📜 Ref: <em>{standard.legalReference}</em>
                              </span>
                            )}
                            <span>
                              Verification:{" "}
                              <strong>{standard.verificationMethod}</strong>
                            </span>
                            {standard.validityPeriodMonths && (
                              <span>
                                Renewal:{" "}
                                <strong>
                                  Every {standard.validityPeriodMonths} mo
                                </strong>
                              </span>
                            )}
                          </div>

                          {matchedCredential && (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: 12,
                                color: "#334155",
                                background: "rgba(255,255,255,0.7)",
                                padding: "4px 8px",
                                borderRadius: 6,
                                display: "inline-block",
                              }}
                            >
                              {matchedCredential.licenseNumber && (
                                <span>
                                  License #{matchedCredential.licenseNumber}{" "}
                                  ·{" "}
                                </span>
                              )}
                              {matchedCredential.expiryDate && (
                                <span>
                                  Expires: {matchedCredential.expiryDate} ·{" "}
                                </span>
                              )}
                              <span>
                                Status:{" "}
                                <strong>{matchedCredential.status}</strong>
                              </span>
                            </div>
                          )}

                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              fontWeight: 700,
                              color: isPassed
                                ? "#166534"
                                : isPending
                                  ? "#0369a1"
                                  : "#991b1b",
                            }}
                          >
                            {reason}
                          </div>
                        </div>

                        {/* Interactive Verification Action Buttons */}
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <Button
                            variant={isPassed ? "secondary" : "primary"}
                            onClick={() =>
                              uploadSampleCredential(
                                standard.credentialCode,
                                standard.name,
                              )
                            }
                          >
                            {isPassed
                              ? "Re-upload"
                              : isPending
                                ? "Replace Document"
                                : "Upload Credential"}
                          </Button>
                          <Button
                            variant="quiet"
                            onClick={() =>
                              toggleCredentialStatus(
                                standard.credentialCode,
                                standard.geography,
                              )
                            }
                          >
                            {isPassed
                              ? "Simulate Expiry"
                              : isPending
                                ? "Simulate Expire"
                                : isExpired
                                  ? "Simulate Missing"
                                  : "Simulate Verify"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}

          {/* Actionable Next Steps / Regulatory Guidance Card */}
          {scorecard.actionItems.length > 0 && (
            <Card tone="amber">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
                📋 Outstanding Compliance Requirements to Unblock Dispatch
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#52606d" }}>
                Complete the following items to achieve 100% verified standing
                for {selectedDomainObj?.label} in {selectedLocObj?.label}:
              </p>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "#172033",
                }}
              >
                {scorecard.actionItems.map((action) => (
                  <li key={action} style={{ marginBottom: 4 }}>
                    <strong>{action}</strong>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        /* Original Active Job Workboard */
        <>
          <Grid columns="repeat(3, minmax(0, 1fr))">
            <Card>
              <Metric
                label="Today’s jobs"
                value="3"
                detail="1 awaiting acceptance"
              />
            </Card>
            <Card>
              <Metric
                label="This month"
                value="$8,420"
                detail="Pending payout $1,240"
              />
            </Card>
            <Card>
              <Metric
                label="Reputation"
                value="4.9 ★"
                detail="183 completed jobs"
              />
            </Card>
          </Grid>
          <Grid columns="minmax(0, 1.35fr) minmax(260px, .65fr)">
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <Status tone={accepted ? "blue" : "amber"}>
                    {accepted
                      ? "Accepted · Live in Progress"
                      : "New assignment · Awaiting Acceptance"}
                  </Status>
                  <h2>
                    {liveJob
                      ? liveJob.description
                      : "AC not cooling — Avery’s Home"}
                  </h2>
                  <p style={{ color: "#52606d" }}>
                    {liveJob ? liveJob.address : "123 King Street W · Toronto"}{" "}
                    · Standard service
                  </p>
                </div>
                <span style={{ fontWeight: 850 }}>
                  Job #
                  {liveJob ? liveJob.id.slice(0, 8).toUpperCase() : "10428"}
                </span>
              </div>
              <Divider />
              <p style={{ color: "#52606d" }}>
                Customer description: system runs, but the air stays warm. One
                photo attached. Equipment: Carrier AC.
              </p>
              {!accepted ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <Button onClick={handleAcceptJob}>Accept job</Button>
                  <Button variant="secondary">Decline</Button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button onClick={handleAdvanceJobStatus}>
                    {current < 2
                      ? "Update status"
                      : current < 4
                        ? "Open assessment"
                        : "Complete job"}
                  </Button>
                  <Button variant="secondary">Message customer</Button>
                </div>
              )}
            </Card>
            <Card tone="blue">
              <h3 style={{ marginTop: 0 }}>Job progress</h3>
              <Stepper steps={jobSteps} current={step} />
              <Divider />
              <p style={{ marginBottom: 0, color: "#52606d", fontSize: 13 }}>
                Quote totals are calculated server-side. Add diagnostic, labour,
                material, equipment, and tax as separate items.
              </p>
            </Card>
          </Grid>
          <Card>
            <h2 style={{ marginTop: 0 }}>Company readiness</h2>
            <Grid>
              <div>
                <Status>Company verified</Status>
                <p style={{ color: "#52606d" }}>
                  ABC Heating & Cooling · Toronto service area
                </p>
              </div>
              <div>
                <Status>Insurance verified</Status>
                <p style={{ color: "#52606d" }}>
                  Expires 30 Jun 2027 · renewal reminders enabled
                </p>
              </div>
              <div>
                <Status>Credential verified</Status>
                <p style={{ color: "#52606d" }}>
                  HVAC_LICENSE · John S. · expires 21 Aug 2027
                </p>
              </div>
            </Grid>
          </Card>
        </>
      )}
    </Shell>
  );
}
