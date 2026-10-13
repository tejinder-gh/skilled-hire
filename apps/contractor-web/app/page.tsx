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
  ProgressBar,
  SegmentedControl,
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

const INITIAL_DEMO_CREDENTIALS: Record<string, SubmittedCredentialInput> = {
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
    expiryDate: "2027-11-30",
    geography: "ON",
    licenseNumber: "WSIB-991204",
  },
  ON_COMMERCIAL_LIABILITY_2M: {
    code: "ON_COMMERCIAL_LIABILITY_2M",
    status: "VERIFIED",
    expiryDate: "2027-10-15",
    geography: "ON",
    licenseNumber: "POL-INT-55029",
  },
};

type MaterialReceiptItem = {
  id: string;
  vendor: string;
  invoiceNumber: string;
  description: string;
  contractorCostCents: number;
  markupPercent: number;
};

type WarrantyClaimItem = {
  id: string;
  jobId: string;
  customerName: string;
  reportedIssue: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY";
  daysSinceCompletion: number;
  status: "OPEN_TRIAGE" | "CURE_OFFERED" | "DISPUTED" | "RESOLVED";
  contractorNotes?: string;
};

export default function ContractorHome() {
  const [activeTab, setActiveTab] = useState<
    "workspace" | "evidence" | "completion" | "warranty" | "compliance"
  >("workspace");

  // Filter state for Compliance Tab
  const [selectedVertical, setSelectedVertical] = useState("hvac");
  const [selectedLocation, setSelectedLocation] = useState("ON");
  const [selectedEntityLevel, setSelectedEntityLevel] = useState<
    EntityLevel | "ALL"
  >("ALL");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<
    CredentialGroupCode | "ALL"
  >("ALL");

  const [userCredentials, setUserCredentials] = useState<
    Record<string, SubmittedCredentialInput>
  >(INITIAL_DEMO_CREDENTIALS);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(
    null,
  );

  // Job Workboard State
  const [dispatchOfferAccepted, setDispatchOfferAccepted] = useState(true);
  const [currentStep, setCurrentStep] = useState(1); // 1 = En Route
  const [etaMinutes, setEtaMinutes] = useState(22);
  const [workerVerified, setWorkerVerified] = useState(true);

  // Field Evidence State
  const [evidencePhotos, setEvidencePhotos] = useState<
    Array<{ id: string; label: string; type: "before" | "after"; timestamp: string }>
  >([
    {
      id: "ev-1",
      label: "Diagnostic test: Burned dual-run capacitor contacts",
      type: "before",
      timestamp: "10:14 AM",
    },
    {
      id: "ev-2",
      label: "Installed OEM Lennox 45/5 uF capacitor & secure wiring",
      type: "after",
      timestamp: "11:02 AM",
    },
  ]);
  const [newPhotoLabel, setNewPhotoLabel] = useState("");
  const [newPhotoType, setNewPhotoType] = useState<"before" | "after">("before");

  // Materials Receipts State
  const [materialReceipts, setMaterialReceipts] = useState<MaterialReceiptItem[]>([
    {
      id: "mat-1",
      vendor: "Noble Trade Supply — Toronto North",
      invoiceNumber: "INV-99412",
      description: "OEM Dual Run Capacitor 45/5 uF 440V Round",
      contractorCostCents: 4200,
      markupPercent: 15,
    },
    {
      id: "mat-2",
      vendor: "Noble Trade Supply — Toronto North",
      invoiceNumber: "INV-99412",
      description: "Heavy-duty spade connectors & heat-shrink wrap",
      contractorCostCents: 1200,
      markupPercent: 15,
    },
  ]);
  const [newVendor, setNewVendor] = useState("Wolseley Industrial Plumbing & HVAC");
  const [newInvoice, setNewInvoice] = useState("WOL-2026-881");
  const [newDesc, setNewDesc] = useState("Refrigerant top-off R-410A (1.5 lbs)");
  const [newCost, setNewCost] = useState("65.00");

  // Completion Report Generator State
  const [completionWorkSummary, setCompletionWorkSummary] = useState(
    "Diagnosed failed capacitor causing compressor hard start. Replaced dual-run capacitor, verified coil temperatures, and cycled air conditioner for 25 minutes. Delta T measured at 18.5°F. Operational amperage within manufacturer specifications.",
  );
  const [equipType, setEquipType] = useState("Central Air Conditioner");
  const [equipBrand, setEquipBrand] = useState("Lennox");
  const [equipModel, setEquipModel] = useState("XC21-036-230");
  const [equipSerial, setEquipSerial] = useState("SN-8821940-2026");
  const [attestationConfirmed, setAttestationConfirmed] = useState(true);
  const [completionSubmitted, setCompletionSubmitted] = useState(false);

  // Warranty Claims Triage State
  const [warrantyClaims, setWarrantyClaims] = useState<WarrantyClaimItem[]>([
    {
      id: "CLM-2026-08A2",
      jobId: "JOB-2026-4412",
      customerName: "Avery H.",
      reportedIssue:
        "Condensate drain line showed minor moisture pooling 4 days after capacitor repair.",
      severity: "MODERATE",
      daysSinceCompletion: 4,
      status: "OPEN_TRIAGE",
    },
  ]);
  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaimItem | null>(null);

  // Compliance calculations
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

  const toggleCredentialStatus = (
    credentialCode: string,
    standardGeography: string,
  ) => {
    setUserCredentials((prev) => {
      const currentVal = prev[credentialCode];
      if (!currentVal) {
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
        return {
          ...prev,
          [credentialCode]: { ...currentVal, status: "PENDING" },
        };
      }
      if (currentVal.status === "PENDING") {
        return {
          ...prev,
          [credentialCode]: {
            ...currentVal,
            status: "VERIFIED",
            expiryDate: "2024-01-01",
          },
        };
      }
      const copy = { ...prev };
      delete copy[credentialCode];
      return copy;
    });
    setSubmissionFeedback(`Updated verification state for ${credentialCode}`);
    setTimeout(() => setSubmissionFeedback(null), 3000);
  };

  const handleAddMaterial = () => {
    const costCents = Math.round(parseFloat(newCost || "0") * 100);
    if (!costCents || isNaN(costCents)) return;
    const item: MaterialReceiptItem = {
      id: `mat-${Date.now()}`,
      vendor: newVendor,
      invoiceNumber: newInvoice,
      description: newDesc,
      contractorCostCents: costCents,
      markupPercent: 15,
    };
    setMaterialReceipts((prev) => [...prev, item]);
    setNewDesc("");
    setNewCost("");
  };

  const totalContractorMaterialsCostCents = materialReceipts.reduce(
    (acc, m) => acc + m.contractorCostCents,
    0,
  );
  const totalBilledMaterialsCents = materialReceipts.reduce(
    (acc, m) => acc + Math.round(m.contractorCostCents * (1 + m.markupPercent / 100)),
    0,
  );

  return (
    <Shell
      title="Contractor & Field Operations Command"
      subtitle="Apple-inspired unified operations portal: live dispatch offers, navigation, evidence locker, materials receipts, structured completion sign-offs, and 365-day warranty claims triage."
      eyebrow="LICENSED TRADE WORKFORCE · ONTARIO TSSA & ESA"
    >
      {/* Primary Apple-style Navigation */}
      <div style={{ marginBottom: 24, overflowX: "auto" }}>
        <SegmentedControl
          ariaLabel="Contractor operations navigation"
          value={activeTab}
          onChange={(tab) => setActiveTab(tab)}
          options={[
            {
              value: "workspace",
              label: "Live Jobs & Dispatch",
              icon: "⚡",
              badge: dispatchOfferAccepted ? undefined : "1 Offer",
            },
            {
              value: "evidence",
              label: "Field Evidence & Receipts",
              icon: "📸",
              badge: materialReceipts.length,
            },
            {
              value: "completion",
              label: "Completion & Sign-Off",
              icon: "📝",
              badge: completionSubmitted ? "Ready" : undefined,
            },
            {
              value: "warranty",
              label: "Warranty & Claims Triage",
              icon: "🛡️",
              badge: warrantyClaims.filter((c) => c.status === "OPEN_TRIAGE").length || undefined,
            },
            {
              value: "compliance",
              label: "Compliance Scorecard",
              icon: "📜",
              badge: `${scorecard.scoreBps / 100}%`,
            },
          ]}
        />
      </div>

      {submissionFeedback && (
        <Callout tone="success" title="Verification Engine Updated">
          {submissionFeedback}
        </Callout>
      )}

      {/* -------------------------------------------------------------
          TAB 1: LIVE JOBS & DISPATCH WORKSPACE
         ------------------------------------------------------------- */}
      {activeTab === "workspace" && (
        <div>
          {!dispatchOfferAccepted ? (
            <Card tone="amber" padding="lg">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Status tone="amber">New High-Priority Dispatch Offer</Status>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                      15-Minute SLA Window
                    </span>
                  </div>
                  <h2 style={{ fontSize: 24, margin: "8px 0 4px" }}>
                    Emergency AC Diagnostic · Toronto (Downtown)
                  </h2>
                  <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                    123 King Street W · Unit 1402 · Distance: 4.8 km (18 min drive)
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#475569" }}>
                    Guaranteed Payout
                  </p>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#0f172a" }}>
                    $240.00 <span style={{ fontSize: 14 }}>CAD</span>
                  </p>
                </div>
              </div>

              <Callout tone="info" title="Customer Scope & Diagnostic Description">
                &ldquo;AC compressor fan humming loudly but outdoor unit fan blades not spinning.
                Room temperature rising rapidly (currently 26°C indoors). Requested immediate
                certified technician arrival.&rdquo;
              </Callout>

              <ProgressBar value={75} max={100} label="Response Window Remaining (11m 15s)" tone="amber" />

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 20,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    setDispatchOfferAccepted(true);
                    setCurrentStep(1);
                  }}
                >
                  ✓ Accept Dispatch Offer
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => alert("Dispatch passed to next eligible on-call provider.")}
                >
                  Decline & Pass Offer
                </Button>
              </div>
            </Card>
          ) : (
            <div>
              {/* Active Job Journey Board */}
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
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Status tone="blue">Active Dispatch In Progress</Status>
                      <Badge tone="neutral">Job #JOB-2026-4412</Badge>
                      <Badge tone="green">Ontario TSSA Validated</Badge>
                    </div>
                    <h2 style={{ fontSize: 26, margin: "8px 0 4px" }}>
                      Lennox Central AC Diagnostic & Repair
                    </h2>
                    <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                      Customer: Avery H. · 123 King Street W · Toronto, ON
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#475569" }}>
                      Estimated Technician Arrival
                    </p>
                    <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#1d4ed8" }}>
                      {etaMinutes} min <span style={{ fontSize: 14 }}>ETA</span>
                    </p>
                  </div>
                </div>

                <div style={{ margin: "24px 0" }}>
                  <Stepper steps={jobSteps} current={currentStep} />
                </div>

                <Divider />

                {/* Real-time State Actions */}
                <div style={{ display: "grid", gap: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                    Technician Action Controls
                  </h3>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Button
                      variant={currentStep === 1 ? "primary" : "secondary"}
                      disabled={currentStep > 1}
                      onClick={() => {
                        setCurrentStep(1);
                        setEtaMinutes(18);
                      }}
                    >
                      🚗 Start Navigation (En Route)
                    </Button>
                    <Button
                      variant={currentStep === 2 ? "primary" : "secondary"}
                      disabled={currentStep >= 2}
                      onClick={() => {
                        setCurrentStep(2);
                        setEtaMinutes(0);
                      }}
                    >
                      📍 Confirm Arrived on Site
                    </Button>
                    <Button
                      variant={currentStep === 3 ? "primary" : "secondary"}
                      disabled={currentStep >= 3}
                      onClick={() => setCurrentStep(3)}
                    >
                      🔍 Begin Assessment
                    </Button>
                    <Button
                      variant={currentStep === 4 ? "primary" : "secondary"}
                      disabled={currentStep >= 4}
                      onClick={() => setCurrentStep(4)}
                    >
                      📋 Present Diagnostic Quote
                    </Button>
                    <Button
                      variant={currentStep === 5 ? "success" : "secondary"}
                      onClick={() => {
                        setCurrentStep(5);
                        setActiveTab("completion");
                      }}
                    >
                      ✓ Complete & Generate Sign-off
                    </Button>
                  </div>

                  {workerVerified && (
                    <Callout tone="success" title="Technician Identity & Credential Gate Verified">
                      Journeyperson Marcus Sterling (TSSA G2 #984210 · Skilled Trades 313A #44912)
                      holds active liability insurance and zero safety quarantines. Customer
                      notified with verified technician badge.
                    </Callout>
                  )}
                </div>
              </Card>

              {/* Quick Metrics */}
              <Grid columns="repeat(auto-fit, minmax(220px, 1fr))">
                <Card padding="sm">
                  <Metric
                    label="Service Rate Card"
                    value="$129.00 CAD"
                    detail="Fixed diagnostic call-out (applied to repair)"
                  />
                </Card>
                <Card padding="sm">
                  <Metric
                    label="Field Evidence Collected"
                    value={`${evidencePhotos.length} Items`}
                    detail="Before & after photos time-stamped"
                  />
                </Card>
                <Card padding="sm">
                  <Metric
                    label="Materials Charged"
                    value={`$${(totalBilledMaterialsCents / 100).toFixed(2)} CAD`}
                    detail="Transparent 15% platform markup verified"
                  />
                </Card>
                <Card padding="sm">
                  <Metric
                    label="Warranty Coverage"
                    value="365 Days"
                    detail="Skilled Hire Workmanship Guarantee"
                  />
                </Card>
              </Grid>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 2: FIELD EVIDENCE & MATERIALS RECEIPTS
         ------------------------------------------------------------- */}
      {activeTab === "evidence" && (
        <div>
          <Card tone="white" padding="lg">
            <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>
              Field Photo Evidence Locker
            </h2>
            <p style={{ margin: "0 0 20px", color: "#475569", fontSize: 14 }}>
              Capture required diagnostic and completion photos. Evidence is cryptographically
              anchored and displayed on homeowner completion reports.
            </p>

            <Grid columns="repeat(auto-fill, minmax(280px, 1fr))">
              {evidencePhotos.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 16,
                    padding: 16,
                    background: photo.type === "before" ? "#fffbeb" : "#ecfdf5",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <Badge tone={photo.type === "before" ? "amber" : "green"}>
                      {photo.type === "before" ? "BEFORE WORK" : "AFTER WORK"}
                    </Badge>
                    <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                      {photo.timestamp}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 120,
                      borderRadius: 12,
                      background: "#e2e8f0",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 32,
                      marginBottom: 10,
                    }}
                  >
                    📷
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {photo.label}
                  </p>
                </div>
              ))}
            </Grid>

            <div style={{ marginTop: 24, padding: 18, background: "#f8fafc", borderRadius: 16 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>
                Attach New Photo Evidence
              </h3>
              <div style={{ display: "grid", gap: 12 }}>
                <Field
                  label="Description / Diagnostic Finding"
                  placeholder="e.g. Suction line pressure gauge showing 118 PSI"
                  value={newPhotoLabel}
                  onChange={setNewPhotoLabel}
                />
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Button
                    variant={newPhotoType === "before" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setNewPhotoType("before")}
                  >
                    Tag as &lsquo;Before&rsquo;
                  </Button>
                  <Button
                    variant={newPhotoType === "after" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setNewPhotoType("after")}
                  >
                    Tag as &lsquo;After&rsquo;
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    disabled={!newPhotoLabel.trim()}
                    onClick={() => {
                      setEvidencePhotos((prev) => [
                        ...prev,
                        {
                          id: `ev-${Date.now()}`,
                          label: newPhotoLabel.trim(),
                          type: newPhotoType,
                          timestamp: "Just now",
                        },
                      ]);
                      setNewPhotoLabel("");
                    }}
                  >
                    + Upload & Seal Evidence
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Materials Receipts Tracker */}
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
                <h2 style={{ fontSize: 22, margin: 0 }}>
                  Materials & Parts Receipts Tracker
                </h2>
                <p style={{ margin: "4px 0 0", color: "#475569", fontSize: 14 }}>
                  Itemized parts receipts with transparent 15% platform markup. Invoices sync with
                  customer invoice and homeowner Property Passport.
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Total Billable Parts
                </p>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
                  ${(totalBilledMaterialsCents / 100).toFixed(2)} CAD
                </p>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Vendor</th>
                    <th style={{ padding: "10px 12px" }}>Invoice #</th>
                    <th style={{ padding: "10px 12px" }}>Part Description</th>
                    <th style={{ padding: "10px 12px" }}>Your Cost</th>
                    <th style={{ padding: "10px 12px" }}>Markup</th>
                    <th style={{ padding: "10px 12px" }}>Customer Total</th>
                  </tr>
                </thead>
                <tbody>
                  {materialReceipts.map((mat) => {
                    const billable = Math.round(
                      mat.contractorCostCents * (1 + mat.markupPercent / 100),
                    );
                    return (
                      <tr key={mat.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px", fontWeight: 700 }}>{mat.vendor}</td>
                        <td style={{ padding: "12px", color: "#64748b" }}>{mat.invoiceNumber}</td>
                        <td style={{ padding: "12px" }}>{mat.description}</td>
                        <td style={{ padding: "12px" }}>
                          ${(mat.contractorCostCents / 100).toFixed(2)}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <Badge tone="blue">+{mat.markupPercent}%</Badge>
                        </td>
                        <td style={{ padding: "12px", fontWeight: 800, color: "#0f172a" }}>
                          ${(billable / 100).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Divider />

            {/* Add Material Row */}
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>
              Record Supplier Part Receipt
            </h3>
            <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
              <Field label="Wholesale Supplier" value={newVendor} onChange={setNewVendor} />
              <Field label="Supplier Invoice #" value={newInvoice} onChange={setNewInvoice} />
              <Field
                label="Part Description & Specs"
                value={newDesc}
                onChange={setNewDesc}
                placeholder="e.g. Honeywell R8184G Protectorelay"
              />
              <Field
                label="Contractor Cost ($ CAD)"
                value={newCost}
                onChange={setNewCost}
                placeholder="0.00"
              />
            </Grid>
            <div style={{ marginTop: 14 }}>
              <Button variant="primary" onClick={handleAddMaterial} disabled={!newDesc || !newCost}>
                + Add Part to Billable Job Summary
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 3: STRUCTURED JOB COMPLETION REPORT GENERATOR
         ------------------------------------------------------------- */}
      {activeTab === "completion" && (
        <div>
          <Card tone="white" padding="lg">
            <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>
              Structured Job Completion Report
            </h2>
            <p style={{ margin: "0 0 20px", color: "#475569", fontSize: 14 }}>
              Upon submission, this report is immediately dispatched to the homeowner for review
              and digital sign-off, automatically generating the 365-day Skilled Hire Workmanship
              Warranty Certificate and logging equipment to the Property Service Passport.
            </p>

            <div style={{ display: "grid", gap: 18 }}>
              <Field
                label="Diagnostic Findings & Completed Work Summary"
                multiline
                value={completionWorkSummary}
                onChange={setCompletionWorkSummary}
              />

              <div style={{ background: "#f8fafc", padding: 18, borderRadius: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>
                  Equipment Service Passport Registration
                </h3>
                <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: 13 }}>
                  Recorded equipment is permanently tied to the property address (123 King Street W)
                  for warranty coverage and future service history.
                </p>
                <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
                  <Field label="Equipment Category" value={equipType} onChange={setEquipType} />
                  <Field label="Manufacturer / Brand" value={equipBrand} onChange={setEquipBrand} />
                  <Field label="Model Number" value={equipModel} onChange={setEquipModel} />
                  <Field label="Serial Number" value={equipSerial} onChange={setEquipSerial} />
                </Grid>
              </div>

              <div
                style={{
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  padding: 16,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <input
                  type="checkbox"
                  id="attestation-checkbox"
                  checked={attestationConfirmed}
                  onChange={(e) => setAttestationConfirmed(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
                <label
                  htmlFor="attestation-checkbox"
                  style={{ fontSize: 13, fontWeight: 700, color: "#1e3a8a", cursor: "pointer" }}
                >
                  I attest that all completed work conforms to Ontario Building Code, TSSA Gas
                  Utilization Code B149.1, and Skilled Trades Ontario standards. Installed parts are
                  new and certified.
                </label>
              </div>

              {completionSubmitted ? (
                <Callout tone="success" title="Completion Report Dispatched to Homeowner">
                  Report successfully transmitted. Homeowner sign-off notification sent via SMS &
                  App. 365-Day Workmanship Warranty #WAR-2026-9F8A1 generated.
                </Callout>
              ) : (
                <div>
                  <Button
                    variant="success"
                    size="lg"
                    disabled={!attestationConfirmed || !completionWorkSummary}
                    onClick={() => setCompletionSubmitted(true)}
                  >
                    ✓ Submit Completion Report & Dispatch Sign-Off
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 4: WARRANTY & CLAIMS TRIAGE
         ------------------------------------------------------------- */}
      {activeTab === "warranty" && (
        <div>
          {/* Recovery Ledger Card */}
          <Card tone="blue" padding="lg">
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
                <Status tone="blue">Platform Warranty & Recovery Ledger</Status>
                <h2 style={{ fontSize: 24, margin: "6px 0 2px" }}>
                  Workmanship Warranty Reserve Account
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  All completed jobs carry 365-day platform workmanship protection. Right-to-cure
                  gives you 48 hours to remediate reported issues before platform intervention.
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Available Holdback Balance
                </span>
                <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#1d4ed8" }}>
                  $850.00 <span style={{ fontSize: 14 }}>CAD</span>
                </p>
              </div>
            </div>

            <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
              <div>
                <Metric label="Active Warranties" value="14 Jobs" detail="All covered under 365-day SLA" />
              </div>
              <div>
                <Metric label="Open Claims" value="1 Item" detail="Awaiting right-to-cure action" />
              </div>
              <div>
                <Metric label="Resolved Remedials" value="100%" detail="Zero customer chargebacks" />
              </div>
            </Grid>
          </Card>

          {/* Incoming Claims List */}
          <Card tone="white" padding="lg">
            <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>
              Incoming Customer Warranty Claims
            </h2>

            {warrantyClaims.length === 0 ? (
              <EmptyState
                icon="🎉"
                title="No Open Warranty Claims"
                description="All completed jobs are currently operating with 100% customer satisfaction."
              />
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {warrantyClaims.map((claim) => (
                  <div
                    key={claim.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 16,
                      padding: 18,
                      background: "#fff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 12,
                        marginBottom: 10,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Badge tone="amber">Claim #{claim.id}</Badge>
                          <Badge tone="neutral">Job #{claim.jobId}</Badge>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                            Day {claim.daysSinceCompletion} of 365
                          </span>
                        </div>
                        <h3 style={{ margin: "6px 0 2px", fontSize: 16, fontWeight: 800 }}>
                          {claim.customerName} · Moderate Callback Request
                        </h3>
                      </div>
                      <Status tone={claim.status === "CURE_OFFERED" ? "green" : "amber"}>
                        {claim.status === "CURE_OFFERED" ? "Callback Scheduled" : "Awaiting Right-to-Cure"}
                      </Status>
                    </div>

                    <p style={{ margin: "0 0 14px", fontSize: 14, color: "#334155" }}>
                      &ldquo;{claim.reportedIssue}&rdquo;
                    </p>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={claim.status === "CURE_OFFERED"}
                        onClick={() => {
                          setWarrantyClaims((prev) =>
                            prev.map((c) =>
                              c.id === claim.id
                                ? { ...c, status: "CURE_OFFERED" }
                                : c,
                            ),
                          );
                        }}
                      >
                        ✓ Exercise Right-to-Cure (Free Remedial Visit)
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedClaim(claim)}
                      >
                        Review Customer Photos & Notes
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Claim Modal Details */}
          {selectedClaim && (
            <Modal
              isOpen={Boolean(selectedClaim)}
              onClose={() => setSelectedClaim(null)}
              title={`Warranty Claim Details · ${selectedClaim.id}`}
            >
              <div style={{ display: "grid", gap: 14 }}>
                <p style={{ margin: 0, fontSize: 14, color: "#334155" }}>
                  <strong>Reported Problem:</strong> {selectedClaim.reportedIssue}
                </p>
                <div
                  style={{
                    height: 140,
                    borderRadius: 12,
                    background: "#f1f5f9",
                    display: "grid",
                    placeItems: "center",
                    color: "#64748b",
                    fontSize: 14,
                  }}
                >
                  📷 Homeowner Attached Photo: Condensate drain pipe junction
                </div>
                <Callout tone="info" title="Right-to-Cure Statutory Policy">
                  Contractor has the right to resolve workmanship defects within 48 hours without
                  financial penalty or platform strike.
                </Callout>
                <Button variant="primary" onClick={() => setSelectedClaim(null)}>
                  Close
                </Button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 5: PROVIDER ONBOARDING & COMPLIANCE SCORECARD
         ------------------------------------------------------------- */}
      {activeTab === "compliance" && (
        <div>
          <Card tone="white" padding="lg">
            <h2 style={{ fontSize: 22, margin: "0 0 6px" }}>
              Multi-Trade Provider Qualification & Compliance
            </h2>
            <p style={{ margin: "0 0 20px", color: "#475569", fontSize: 14 }}>
              Skilled Hire enforces strict 100% statutory credential compliance. Select your trade
              vertical and jurisdiction to test verification status.
            </p>

            <Grid columns="repeat(auto-fit, minmax(220px, 1fr))">
              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
                Trade Domain
                <select
                  value={selectedVertical}
                  onChange={(e) => setSelectedVertical(e.target.value)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                  }}
                >
                  {DOMAINS.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.icon} {d.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
                Jurisdiction
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                  }}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </Grid>

            <Divider />

            {/* Scorecard Hero */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
                padding: 20,
                borderRadius: 18,
                background:
                  scorecard.overallStatus === "VERIFIED"
                    ? "#ecfdf5"
                    : "#fffbeb",
                border: `1.5px solid ${scorecard.overallStatus === "VERIFIED" ? "#a7f3d0" : "#fde68a"}`,
                marginBottom: 24,
              }}
            >
              <div>
                <Status tone={scorecard.overallStatus === "VERIFIED" ? "green" : "amber"}>
                  {scorecard.overallStatus === "VERIFIED"
                    ? "✓ 100% Fully Verified for Dispatch"
                    : "⚠️ Mandatory Credentials Deficient"}
                </Status>
                <h3 style={{ margin: "8px 0 4px", fontSize: 20, fontWeight: 800 }}>
                  Statutory Scorecard: {scorecard.mandatoryPassed} of {scorecard.mandatoryTotal}{" "}
                  Mandatory Standards Passed
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                  Regulatory standards enforced under Ontario Trades & Safety Authorities.
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: "#0f172a" }}>
                  {scorecard.scoreBps / 100}%
                </span>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Compliance Index
                </p>
              </div>
            </div>

            {/* Interactive Standards Checklist */}
            <h3 style={{ fontSize: 16, margin: "0 0 12px" }}>
              Applicable Credential Verification Checklist
            </h3>

            <div style={{ display: "grid", gap: 10 }}>
              {applicableStandards.map((std) => {
                const isHeld = Boolean(userCredentials[std.credentialCode]);
                const cred = userCredentials[std.credentialCode];
                const isVerified = cred?.status === "VERIFIED";

                return (
                  <div
                    key={std.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: "14px 18px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                      background: isVerified ? "#fff" : "#fafafa",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                          {std.name}
                        </span>
                        <Badge tone={std.requirementLevel === "MANDATORY" ? "danger" : "neutral"}>
                          {std.requirementLevel}
                        </Badge>
                      </div>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
                        Authority: {std.issuingAuthority} · {std.credentialCode}
                        {cred?.licenseNumber && ` · License #${cred.licenseNumber}`}
                      </p>
                    </div>

                    <Button
                      variant={isVerified ? "success" : "secondary"}
                      size="sm"
                      onClick={() => toggleCredentialStatus(std.credentialCode, std.geography)}
                    >
                      {isVerified ? "✓ Verified & Active" : "+ Click to Upload & Verify"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
