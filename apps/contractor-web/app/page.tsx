"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ComplianceEvaluationStatus,
  CredentialGroupCode,
  CredentialStatus,
  EntityLevel,
  ProviderApplicationDTO,
  ProviderRateProposal,
  SubmittedCredentialInput,
  TechnicianRosterInput,
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
  assessOnboardingReadiness,
  CANONICAL_TRADE_CATALOG,
  checkRateProposalSanity,
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  filterComplianceStandards,
  validateAndNormalizePostalTerritories,
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

const ONTARIO_CORE_FSAS = ["M5V", "M4B", "M2N", "L4W", "K1P", "N2L"] as const;

export default function ContractorHome() {
  const [activeTab, setActiveTab] = useState<
    "workspace" | "evidence" | "completion" | "warranty" | "compliance" | "onboarding"
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

  // ---------------------------------------------------------------------------
  // Provider Onboarding & Supply CRM State
  // ---------------------------------------------------------------------------
  const [onboardingStep, setOnboardingStep] = useState<number>(0); // 0-indexed for Stepper (0..4)
  const [saveToken, setSaveToken] = useState<string>("");
  const [resumeTokenInput, setResumeTokenInput] = useState<string>("");
  const [isResumeModalOpen, setIsResumeModalOpen] = useState<boolean>(false);
  const [applicationId, setApplicationId] = useState<string>("");
  const [onboardingNotice, setOnboardingNotice] = useState<{
    tone: "info" | "success" | "danger" | "warning";
    message: string;
  } | null>(null);

  // Step 1: Legal Business Identity & Ontario Corporate Registry
  const [legalBusinessName, setLegalBusinessName] = useState("MapleShield Mechanical Solutions Inc.");
  const [tradeName, setTradeName] = useState("MapleShield HVAC & Plumbing");
  const [businessNumber, setBusinessNumber] = useState("892341209");
  const [registryNumber, setRegistryNumber] = useState("ON-2023-882194");
  const [contactName, setContactName] = useState("Darren Tremblay");
  const [contactEmail, setContactEmail] = useState("operations@mapleshield.test");
  const [contactPhone, setContactPhone] = useState("+14165550188");
  const [streetAddress, setStreetAddress] = useState("180 Adelaide St W, Suite 600");
  const [city, setCity] = useState("Toronto");
  const [postalCode, setPostalCode] = useState("M5H 3G2");

  // Step 2: Multi-Trade Selection & Rate Proposals
  const [selectedTradeSlugs, setSelectedTradeSlugs] = useState<string[]>(["hvac", "plumbing"]);
  const [rateProposals, setRateProposals] = useState<Record<string, ProviderRateProposal>>({
    hvac: {
      verticalSlug: "hvac",
      hourlyRateCents: 11500, // $115/hr
      diagnosticFeeCents: 8900, // $89
      emergencyRateMultiplierBps: 15000, // 1.5x
    },
    plumbing: {
      verticalSlug: "plumbing",
      hourlyRateCents: 11000, // $110/hr
      diagnosticFeeCents: 7900, // $79
      emergencyRateMultiplierBps: 15000, // 1.5x
    },
  });

  // Step 3: Postal Territory Coverage & Weekly Capacity
  const [selectedFsas, setSelectedFsas] = useState<string[]>(["M5V", "M4B", "M2N", "L4W"]);
  const [customFsaInput, setCustomFsaInput] = useState("");
  const [weeklyJobsCapacity, setWeeklyJobsCapacity] = useState<number>(18);
  const [maxActiveDispatches, setMaxActiveDispatches] = useState<number>(4);
  const [emergencyRadiusKm, setEmergencyRadiusKm] = useState<number>(35);

  // Step 4: Technician Roster & Licensing
  const [technicians, setTechnicians] = useState<TechnicianRosterInput[]>([
    {
      fullName: "Darren Tremblay",
      email: "darren.tremblay@mapleshield.test",
      phone: "+14165550188",
      tradeLicenseCode: "TSSA Gas Fitter G1",
      licenseNumber: "TSSA-G1-992144",
      licenseExpiry: "2027-12-31",
      isEmergencyAvailable: true,
    },
    {
      fullName: "Chloe Nguyen",
      email: "chloe.nguyen@mapleshield.test",
      phone: "+14165550299",
      tradeLicenseCode: "Skilled Trades Ontario 306A Plumber",
      licenseNumber: "STO-306A-881273",
      licenseExpiry: "2027-12-31",
      isEmergencyAvailable: true,
    },
  ]);
  const [newTechName, setNewTechName] = useState("");
  const [newTechEmail, setNewTechEmail] = useState("");
  const [newTechPhone, setNewTechPhone] = useState("");
  const [newTechTrade, setNewTechTrade] = useState("hvac");
  const [newTechLicense, setNewTechLicense] = useState("TSSA Gas Technician");
  const [newTechNumber, setNewTechNumber] = useState("");

  // Step 5: Covenants, Insurance & Attestation
  const [wsibNumber, setWsibNumber] = useState("WSIB-ON-9811234");
  const [cglPolicyNumber, setCglPolicyNumber] = useState("INTACT-CGL-5M-449102");
  const [cglCoverageAmountCents, setCglCoverageAmountCents] = useState(500000000); // $5M
  const [backgroundConsentAttested, setBackgroundConsentAttested] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(true);

  // Submission State
  const [isSubmittingOnboarding, setIsSubmittingOnboarding] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [submittedApplication, setSubmittedApplication] = useState<{
    id: string;
    status: string;
    submittedAt: string;
    readinessScore: number;
    saveToken: string;
  } | null>(null);

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

  // ---------------------------------------------------------------------------
  // Provider Onboarding Helper Handlers
  // ---------------------------------------------------------------------------
  const handleToggleTrade = (slug: string) => {
    setSelectedTradeSlugs((prev) => {
      const exists = prev.includes(slug);
      const next = exists ? prev.filter((s) => s !== slug) : [...prev, slug];
      if (!exists && !rateProposals[slug]) {
        setRateProposals((rp) => ({
          ...rp,
          [slug]: {
            verticalSlug: slug,
            hourlyRateCents: 11000,
            diagnosticFeeCents: 7900,
            emergencyRateMultiplierBps: 15000,
          },
        }));
      }
      return next;
    });
  };

  const handleToggleFsa = (fsa: string) => {
    const res = validateAndNormalizePostalTerritories([fsa]);
    const normalized = res.normalizedFsaList[0];
    if (!normalized) return;
    setSelectedFsas((prev) =>
      prev.includes(normalized) ? prev.filter((f) => f !== normalized) : [...prev, normalized],
    );
  };

  const handleAddCustomFsa = () => {
    if (!customFsaInput.trim()) return;
    const res = validateAndNormalizePostalTerritories([customFsaInput]);
    const normalized = res.normalizedFsaList[0];
    if (!normalized) {
      setOnboardingNotice({
        tone: "danger",
        message: `Invalid Ontario FSA format '${customFsaInput}'. Must be M, L, K, N, or P followed by digit and letter (e.g. M5V).`,
      });
      return;
    }
    if (!selectedFsas.includes(normalized)) {
      setSelectedFsas((prev) => [...prev, normalized]);
    }
    setCustomFsaInput("");
    setOnboardingNotice(null);
  };

  const handleAddTechnician = () => {
    if (
      !newTechName.trim() ||
      !newTechEmail.trim() ||
      !newTechPhone.trim() ||
      !newTechNumber.trim()
    ) {
      setOnboardingNotice({
        tone: "warning",
        message: "Please provide technician full name, email, phone, and trade license number.",
      });
      return;
    }
    const member: TechnicianRosterInput = {
      fullName: newTechName.trim(),
      email: newTechEmail.trim(),
      phone: newTechPhone.trim(),
      tradeLicenseCode: newTechLicense.trim(),
      licenseNumber: newTechNumber.trim(),
      licenseExpiry: "2027-12-31",
      isEmergencyAvailable: true,
    };
    setTechnicians((prev) => [...prev, member]);
    setNewTechName("");
    setNewTechEmail("");
    setNewTechPhone("");
    setNewTechNumber("");
    setOnboardingNotice({
      tone: "success",
      message: `Added technician ${member.fullName} to roster.`,
    });
  };

  const handleRemoveTechnician = (idx: number) => {
    setTechnicians((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    setOnboardingNotice(null);
    const payload = {
      saveToken: saveToken || undefined,
      prospectEmail: contactEmail,
      businessName: legalBusinessName,
      businessNumber,
      businessType: "CORPORATION" as const,
      phone: contactPhone,
      postalCodes: selectedFsas,
      selectedVerticals: selectedTradeSlugs,
      serviceRatesProposal: selectedTradeSlugs.map((slug) => rateProposals[slug] ?? {
        verticalSlug: slug,
        hourlyRateCents: 11000,
        diagnosticFeeCents: 7900,
        emergencyRateMultiplierBps: 15000,
      }),
      weeklyCapacity: weeklyJobsCapacity,
      draftStep: onboardingStep,
    };

    try {
      const res = await fetch("http://localhost:4000/v1/providers/onboarding/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSaveToken(data.saveToken);
        setApplicationId(data.applicationId);
        setOnboardingNotice({
          tone: "success",
          message: `Application draft saved! Resume token: ${data.saveToken}`,
        });
        return;
      }
    } catch {
      // Offline fallback
    } finally {
      setIsSavingDraft(false);
    }

    const fallbackToken = saveToken || `tok_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const fallbackAppId = applicationId || `APP-${Date.now()}-101`;
    setSaveToken(fallbackToken);
    setApplicationId(fallbackAppId);
    setOnboardingNotice({
      tone: "success",
      message: `Application draft saved locally! Resume token: ${fallbackToken}`,
    });
  };

  const handleResumeDraft = async () => {
    if (!resumeTokenInput.trim()) return;
    try {
      const res = await fetch(
        `http://localhost:4000/v1/providers/onboarding/draft/${resumeTokenInput.trim()}`,
      );
      if (res.ok) {
        const app = await res.json();
        setApplicationId(app.id);
        setSaveToken(app.saveToken || resumeTokenInput.trim());
        if (app.businessName) setLegalBusinessName(app.businessName);
        if (app.businessNumber) setBusinessNumber(app.businessNumber);
        if (app.prospectEmail) setContactEmail(app.prospectEmail);
        if (app.phone) setContactPhone(app.phone);
        if (app.postalCodes?.length) setSelectedFsas(app.postalCodes);
        if (app.selectedVerticals?.length) setSelectedTradeSlugs(app.selectedVerticals);
        if (app.serviceRatesProposal?.length) {
          const map: Record<string, ProviderRateProposal> = {};
          for (const rp of app.serviceRatesProposal) {
            map[rp.verticalSlug] = rp;
          }
          setRateProposals(map);
        }
        if (app.weeklyCapacity) setWeeklyJobsCapacity(app.weeklyCapacity);
        if (app.technicians?.length) {
          setTechnicians(
            app.technicians.map((t: { fullName: string; email: string; phone: string; tradeLicenseCode: string; licenseNumber: string; licenseExpiry?: string; isEmergencyAvailable?: boolean }) => ({
              fullName: t.fullName,
              email: t.email,
              phone: t.phone,
              tradeLicenseCode: t.tradeLicenseCode,
              licenseNumber: t.licenseNumber,
              licenseExpiry: t.licenseExpiry || "2027-12-31",
              isEmergencyAvailable: Boolean(t.isEmergencyAvailable),
            })),
          );
        }
        setIsResumeModalOpen(false);
        setOnboardingNotice({
          tone: "success",
          message: `Application draft loaded from token ${resumeTokenInput.trim()}`,
        });
        return;
      }
    } catch {
      // offline fallback
    }
    setIsResumeModalOpen(false);
    setOnboardingNotice({
      tone: "info",
      message: `Draft token ${resumeTokenInput.trim()} resumed.`,
    });
  };

  const handleSubmitApplication = async () => {
    setIsSubmittingOnboarding(true);
    setOnboardingNotice(null);
    const payload = {
      saveToken: saveToken || `tok_${Date.now()}_local`,
      businessNumber,
      businessType: "CORPORATION" as const,
      postalCodes: selectedFsas,
      selectedVerticals: selectedTradeSlugs,
      serviceRatesProposal: selectedTradeSlugs.map((slug) => rateProposals[slug] ?? {
        verticalSlug: slug,
        hourlyRateCents: 11000,
        diagnosticFeeCents: 7900,
        emergencyRateMultiplierBps: 15000,
      }),
      weeklyCapacity: weeklyJobsCapacity,
      technicians,
      consentAccepted: backgroundConsentAttested && termsAccepted,
    };

    try {
      const res = await fetch("http://localhost:4000/v1/providers/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSubmittedApplication({
          id: data.applicationId,
          status: data.status,
          submittedAt: new Date().toISOString(),
          readinessScore: 95,
          saveToken: saveToken || `tok_${Date.now()}`,
        });
        setOnboardingNotice({
          tone: "success",
          message: "Application submitted successfully for Ontario Operations accreditation!",
        });
        return;
      } else {
        const err = await res.json();
        setOnboardingNotice({
          tone: "danger",
          message: err.message || "Submission failed. Please check validation requirements.",
        });
        return;
      }
    } catch {
      // fallback
    } finally {
      setIsSubmittingOnboarding(false);
    }

    setSubmittedApplication({
      id: applicationId || `APP-${Date.now()}-202`,
      status: "SUBMITTED",
      submittedAt: new Date().toISOString(),
      readinessScore: 95,
      saveToken: saveToken || `tok_${Date.now()}_local`,
    });
    setOnboardingNotice({
      tone: "success",
      message: "Application submitted successfully for Ontario Operations accreditation!",
    });
  };

  const computedReadiness = useMemo(() => {
    const dto: ProviderApplicationDTO = {
      id: applicationId || "mock-app",
      prospectEmail: contactEmail,
      businessName: legalBusinessName,
      businessNumber,
      businessType: "CORPORATION",
      phone: contactPhone,
      postalCodes: selectedFsas,
      selectedVerticals: selectedTradeSlugs,
      serviceRatesProposal: selectedTradeSlugs.map((slug) => rateProposals[slug] ?? {
        verticalSlug: slug,
        hourlyRateCents: 11000,
        diagnosticFeeCents: 7900,
        emergencyRateMultiplierBps: 15000,
      }),
      weeklyCapacity: weeklyJobsCapacity,
      technicianCount: technicians.length,
      status: "SUBMITTED",
      saveToken: saveToken || "mock-token",
      draftStep: onboardingStep,
      consentAccepted: backgroundConsentAttested && termsAccepted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      technicians: technicians.map((t, idx) => ({
        id: `tech-${idx}`,
        applicationId: applicationId || "mock-app",
        fullName: t.fullName,
        email: t.email,
        phone: t.phone,
        tradeLicenseCode: t.tradeLicenseCode,
        licenseNumber: t.licenseNumber,
        licenseExpiry: t.licenseExpiry,
        backgroundCheckStatus: "CLEARED",
        isEmergencyAvailable: Boolean(t.isEmergencyAvailable),
        createdAt: new Date().toISOString(),
      })),
    };
    return assessOnboardingReadiness(dto);
  }, [
    applicationId,
    contactEmail,
    legalBusinessName,
    businessNumber,
    contactPhone,
    selectedFsas,
    selectedTradeSlugs,
    rateProposals,
    weeklyJobsCapacity,
    technicians,
    saveToken,
    onboardingStep,
    backgroundConsentAttested,
    termsAccepted,
  ]);

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
            {
              value: "onboarding",
              label: "Provider Onboarding",
              icon: "🚀",
              badge: submittedApplication ? "Submitted" : saveToken ? "Draft" : undefined,
            },
          ]}
        />
      </div>

      {submissionFeedback && (
        <Callout tone="success" title="Verification Engine Updated">
          {submissionFeedback}
        </Callout>
      )}

      {onboardingNotice && (
        <div style={{ marginBottom: 20 }}>
          <Callout tone={onboardingNotice.tone} title="Onboarding System">
            {onboardingNotice.message}
          </Callout>
        </div>
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

      {/* -------------------------------------------------------------
          TAB 6: PROVIDER ONBOARDING & SUPPLY CRM
         ------------------------------------------------------------- */}
      {activeTab === "onboarding" && (
        <div style={{ display: "grid", gap: 24 }}>
          {/* Submission Receipt View */}
          {submittedApplication ? (
            <Card tone="white" padding="lg">
              <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>
                Provider Application Submitted for Accreditation
              </h2>
              <p style={{ margin: "0 0 16px", color: "#475569", fontSize: 14 }}>
                Your application is now under active review by Skilled Hire Operations.
              </p>
              <div
                style={{
                  padding: "24px",
                  background: "#f0fdf4",
                  borderRadius: 16,
                  border: "1px solid #bbf7d0",
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    backgroundColor: "#16a34a",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 24,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: "#166534" }}>
                    Application Successfully Registered
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#15803d" }}>
                    ID: {submittedApplication.id} · Reference Token: {submittedApplication.saveToken}
                  </p>
                </div>
              </div>

              <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
                <Metric
                  label="Application Status"
                  value={submittedApplication.status}
                  detail="Awaiting Ontario CRM Audit"
                />
                <Metric
                  label="Readiness Index"
                  value={`${submittedApplication.readinessScore}%`}
                  detail="Statutory Accreditation Score"
                />
                <Metric
                  label="Active Trades"
                  value={String(selectedTradeSlugs.length)}
                  detail={selectedTradeSlugs.join(", ")}
                />
                <Metric
                  label="Coverage FSAs"
                  value={String(selectedFsas.length)}
                  detail={selectedFsas.join(", ")}
                />
              </Grid>

              <div style={{ marginTop: 24 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Statutory Accreditation Breakdown</h4>
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>1. Business Identity & CRA 9-digit BN</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                        {legalBusinessName} · BN #{businessNumber} · Registry #{registryNumber}
                      </p>
                    </div>
                    <Badge tone="green">Verified (20/20)</Badge>
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>2. Multi-Service Trade Catalog & Rates</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                        {selectedTradeSlugs.length} Trades · Rate Proposals Benchmarked
                      </p>
                    </div>
                    <Badge tone="green">Verified (20/20)</Badge>
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>3. Postal Territory & Dispatch Capacity</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                        {selectedFsas.length} Ontario FSAs · Capacity: {weeklyJobsCapacity} jobs/wk
                      </p>
                    </div>
                    <Badge tone="green">Verified (20/20)</Badge>
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>4. Technician Roster & Trade Licensing</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                        {technicians.length} Licensed tradespersons · TSSA / Skilled Trades Ontario
                      </p>
                    </div>
                    <Badge tone="green">Verified (20/20)</Badge>
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>5. Insurance Covenants & Background Checks</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                        WSIB #{wsibNumber} · $5M CGL Policy #{cglPolicyNumber}
                      </p>
                    </div>
                    <Badge tone="green">Verified (20/20)</Badge>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setSubmittedApplication(null);
                    setActiveTab("workspace");
                  }}
                >
                  Return to Dispatch Command
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSubmittedApplication(null);
                    setOnboardingStep(0);
                  }}
                >
                  Edit / Submit Another Application
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {/* Wizard Header Bar */}
              <Card tone="white" padding="lg">
                <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>
                  Ontario Trade Contractor Accreditation
                </h2>
                <p style={{ margin: "0 0 16px", color: "#475569", fontSize: 14 }}>
                  Complete trade verification, postal territory allocation, technician credentialing, and rate alignment.
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#64748b" }}>Readiness Score:</span>
                    <Badge tone={computedReadiness.readinessScoreBps >= 8000 ? "green" : "amber"}>
                      {computedReadiness.readinessScoreBps / 100}% Index
                    </Badge>
                    {saveToken && (
                      <span
                        style={{
                          fontSize: 12,
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          padding: "4px 8px",
                          borderRadius: 6,
                          fontWeight: 600,
                        }}
                      >
                        Draft: {saveToken}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsResumeModalOpen(true)}
                    >
                      📂 Resume Draft
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isSavingDraft}
                      onClick={handleSaveDraft}
                    >
                      {isSavingDraft ? "Saving..." : "💾 Save Progress"}
                    </Button>
                  </div>
                </div>

                {/* Progress Stepper */}
                <div style={{ marginBottom: 28 }}>
                  <Stepper
                    current={onboardingStep}
                    steps={[
                      "1. Business Identity",
                      "2. Multi-Trade & Rates",
                      "3. Territory & Capacity",
                      "4. Technician Roster",
                      "5. Legal & Attestation",
                    ]}
                  />
                </div>

                {/* STEP 0: Business Identity */}
                {onboardingStep === 0 && (
                  <div style={{ display: "grid", gap: 18 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                      Step 1: Legal Business Identity & Corporate Registration
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      Provide official corporate identity. CRA 9-digit Business Numbers (BN) are checked for duplicate prevention.
                    </p>

                    <Grid columns="repeat(auto-fit, minmax(280px, 1fr))">
                      <Field
                        label="Legal Corporate Name"
                        value={legalBusinessName}
                        onChange={setLegalBusinessName}
                        placeholder="e.g. MapleShield Mechanical Solutions Inc."
                      />

                      <Field
                        label="Trade Name / Operating DBA"
                        value={tradeName}
                        onChange={setTradeName}
                        placeholder="e.g. MapleShield HVAC"
                      />

                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>CRA 9-Digit Business Number (BN)</span>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            value={businessNumber}
                            onChange={(e) => setBusinessNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
                            placeholder="e.g. 892341209"
                            style={{
                              flex: 1,
                              padding: "13px 16px",
                              borderRadius: 14,
                              border: "1px solid #cbd5e1",
                              fontSize: 14,
                            }}
                          />
                          <Badge tone={/^\d{9}$/.test(businessNumber) ? "green" : "neutral"}>
                            {/^\d{9}$/.test(businessNumber) ? "✓ 9 Digits" : "Must be 9 digits"}
                          </Badge>
                        </div>
                      </label>

                      <Field
                        label="Ontario Corporate Registry Number"
                        value={registryNumber}
                        onChange={setRegistryNumber}
                        placeholder="e.g. ON-2023-882194"
                      />

                      <Field
                        label="Operating Contact Name"
                        value={contactName}
                        onChange={setContactName}
                        placeholder="e.g. Darren Tremblay"
                      />

                      <Field
                        label="Operating Email Address"
                        value={contactEmail}
                        onChange={setContactEmail}
                        placeholder="operations@example.com"
                        type="email"
                      />

                      <Field
                        label="Direct Phone Number"
                        value={contactPhone}
                        onChange={setContactPhone}
                        placeholder="+14165550188"
                        type="tel"
                      />

                      <Field
                        label="Physical Street Address"
                        value={streetAddress}
                        onChange={setStreetAddress}
                        placeholder="e.g. 180 Adelaide St W, Suite 600"
                      />

                      <Field
                        label="City"
                        value={city}
                        onChange={setCity}
                        placeholder="Toronto"
                      />

                      <Field
                        label="Ontario Postal Code"
                        value={postalCode}
                        onChange={(val) => setPostalCode(val.toUpperCase())}
                        placeholder="M5H 3G2"
                      />
                    </Grid>
                  </div>
                )}

                {/* STEP 1: Multi-Service Trade Selection & Rate Proposals */}
                {onboardingStep === 1 && (
                  <div style={{ display: "grid", gap: 18 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                      Step 2: Multi-Service Trade Selection & Rate Proposals
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      Select all canonical trade verticals your company services. Propose hourly and diagnostic rates for automated Ontario benchmark sanity checks.
                    </p>

                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 8 }}>
                        Canonical Trades (Click to toggle)
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {CANONICAL_TRADE_CATALOG.slice(0, 10).map((trade) => {
                          const isSelected = selectedTradeSlugs.includes(trade.slug);
                          return (
                            <button
                              key={trade.slug}
                              type="button"
                              onClick={() => handleToggleTrade(trade.slug)}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 20,
                                border: isSelected ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
                                background: isSelected ? "#eff6ff" : "#fff",
                                color: isSelected ? "#1d4ed8" : "#334155",
                                fontWeight: isSelected ? 700 : 500,
                                fontSize: 13,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span>{domainIcons[trade.slug] || "🔨"}</span>
                              <span>{trade.name}</span>
                              {isSelected && <span>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>
                        Rate Proposals for Selected Services ({selectedTradeSlugs.length})
                      </span>

                      {selectedTradeSlugs.map((slug) => {
                        const trade = CANONICAL_TRADE_CATALOG.find((t) => t.slug === slug);
                        const proposal = rateProposals[slug] ?? {
                          verticalSlug: slug,
                          hourlyRateCents: 11000,
                          diagnosticFeeCents: 7900,
                          emergencyRateMultiplierBps: 15000,
                        };
                        const sanity = checkRateProposalSanity([proposal]);

                        return (
                          <div
                            key={slug}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: 14,
                              padding: "16px 20px",
                              background: "#f8fafc",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 12,
                                flexWrap: "wrap",
                                gap: 8,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 18 }}>{domainIcons[slug] || "🔧"}</span>
                                <span style={{ fontWeight: 800, fontSize: 15 }}>
                                  {trade?.name || slug}
                                </span>
                              </div>
                              <Badge tone={sanity.valid ? "green" : "amber"}>
                                {sanity.valid ? "✓ Within Ontario Benchmark" : "Caution: Rate Anomaly"}
                              </Badge>
                            </div>

                            <Grid columns="repeat(auto-fit, minmax(180px, 1fr))">
                              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                                <span>Standard Hourly Rate ($)</span>
                                <input
                                  type="number"
                                  value={(proposal.hourlyRateCents / 100).toFixed(0)}
                                  onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value || "0", 10));
                                    setRateProposals((prev) => ({
                                      ...prev,
                                      [slug]: {
                                        verticalSlug: slug,
                                        hourlyRateCents: val * 100,
                                        diagnosticFeeCents: proposal.diagnosticFeeCents,
                                        emergencyRateMultiplierBps: proposal.emergencyRateMultiplierBps,
                                      },
                                    }));
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 14px",
                                    borderRadius: 10,
                                    border: "1px solid #cbd5e1",
                                    fontSize: 14,
                                  }}
                                />
                              </label>

                              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                                <span>Diagnostic Fee ($)</span>
                                <input
                                  type="number"
                                  value={((proposal.diagnosticFeeCents || 0) / 100).toFixed(0)}
                                  onChange={(e) => {
                                    const val = Math.max(0, parseInt(e.target.value || "0", 10));
                                    setRateProposals((prev) => ({
                                      ...prev,
                                      [slug]: {
                                        verticalSlug: slug,
                                        hourlyRateCents: proposal.hourlyRateCents,
                                        diagnosticFeeCents: val * 100,
                                        emergencyRateMultiplierBps: proposal.emergencyRateMultiplierBps,
                                      },
                                    }));
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 14px",
                                    borderRadius: 10,
                                    border: "1px solid #cbd5e1",
                                    fontSize: 14,
                                  }}
                                />
                              </label>

                              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                                <span>Emergency Multiplier (BPS)</span>
                                <input
                                  type="number"
                                  value={proposal.emergencyRateMultiplierBps ?? 15000}
                                  onChange={(e) => {
                                    const val = Math.max(10000, parseInt(e.target.value || "15000", 10));
                                    setRateProposals((prev) => ({
                                      ...prev,
                                      [slug]: {
                                        verticalSlug: slug,
                                        hourlyRateCents: proposal.hourlyRateCents,
                                        diagnosticFeeCents: proposal.diagnosticFeeCents,
                                        emergencyRateMultiplierBps: val,
                                      },
                                    }));
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 14px",
                                    borderRadius: 10,
                                    border: "1px solid #cbd5e1",
                                    fontSize: 14,
                                  }}
                                />
                              </label>
                            </Grid>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* STEP 2: Territory & Capacity */}
                {onboardingStep === 2 && (
                  <div style={{ display: "grid", gap: 18 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                      Step 3: Ontario Postal Territory (FSA Zones) & Weekly Capacity
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      Select Ontario Forward Sortation Areas (3-character postal codes like M5V, M4B) you commit to dispatching to.
                    </p>

                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 8 }}>
                        Quick Territory Presets
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedFsas((prev) => Array.from(new Set([...prev, "M5V", "M4B"])));
                          }}
                        >
                          + GTA Downtown Core (M5V, M4B)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedFsas((prev) => Array.from(new Set([...prev, "M2N"])));
                          }}
                        >
                          + York Region (M2N)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedFsas((prev) => Array.from(new Set([...prev, "L4W"])));
                          }}
                        >
                          + Peel Region / Mississauga (L4W)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedFsas((prev) => Array.from(new Set([...prev, "K1P"])));
                          }}
                        >
                          + Ottawa Capital (K1P)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelectedFsas([...ONTARIO_CORE_FSAS])}
                        >
                          + All Core Ontario Hubs
                        </Button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>Add Custom Ontario FSA Code (e.g. M5V, L4W, K1P)</span>
                        <input
                          type="text"
                          value={customFsaInput}
                          onChange={(e) => setCustomFsaInput(e.target.value.toUpperCase())}
                          placeholder="e.g. M5J"
                          maxLength={3}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            fontSize: 14,
                            width: 160,
                          }}
                        />
                      </label>
                      <Button variant="secondary" onClick={handleAddCustomFsa}>
                        Add FSA
                      </Button>
                    </div>

                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 8 }}>
                        Selected Primary Dispatch Zones ({selectedFsas.length})
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {selectedFsas.map((fsa) => (
                          <div
                            key={fsa}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              background: "#eff6ff",
                              border: "1px solid #bfdbfe",
                              color: "#1d4ed8",
                              fontWeight: 700,
                              fontSize: 13,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <span>{fsa}</span>
                            <button
                              type="button"
                              onClick={() => handleToggleFsa(fsa)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#93c5fd",
                                cursor: "pointer",
                                fontSize: 14,
                                padding: 0,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Divider />

                    <h4 style={{ margin: "8px 0 0", fontSize: 15 }}>Operational Capacity Controls</h4>
                    <Grid columns="repeat(auto-fit, minmax(220px, 1fr))">
                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>Weekly Target Job Capacity</span>
                        <input
                          type="number"
                          value={weeklyJobsCapacity}
                          onChange={(e) => setWeeklyJobsCapacity(Math.max(1, parseInt(e.target.value || "1", 10)))}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            fontSize: 14,
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>Max Active Concurrent Dispatches</span>
                        <input
                          type="number"
                          value={maxActiveDispatches}
                          onChange={(e) => setMaxActiveDispatches(Math.max(1, parseInt(e.target.value || "1", 10)))}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            fontSize: 14,
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>Max Emergency Dispatch Radius (km)</span>
                        <input
                          type="number"
                          value={emergencyRadiusKm}
                          onChange={(e) => setEmergencyRadiusKm(Math.max(5, parseInt(e.target.value || "5", 10)))}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            fontSize: 14,
                          }}
                        />
                      </label>
                    </Grid>
                  </div>
                )}

                {/* STEP 3: Technician Roster & Licensing */}
                {onboardingStep === 3 && (
                  <div style={{ display: "grid", gap: 18 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                      Step 4: Technician Roster & Trade Licensing Verification
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      Register each licensed technician. Individual trade licenses (TSSA Gas, Skilled Trades Ontario 306A/309A) are audited fail-closed before dispatch privileges.
                    </p>

                    <div style={{ display: "grid", gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>
                        Current Team Roster ({technicians.length} Technicians)
                      </span>
                      {technicians.map((tech, idx) => (
                        <div
                          key={`${tech.email}-${idx}`}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: "14px 18px",
                            background: "#fff",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 12,
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <strong style={{ fontSize: 15 }}>{tech.fullName}</strong>
                              <Badge tone="green">
                                {tech.isEmergencyAvailable ? "24/7 Emergency Active" : "Standard Active"}
                              </Badge>
                            </div>
                            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
                              {tech.email} · {tech.phone}
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#1e293b", fontWeight: 600 }}>
                              {tech.tradeLicenseCode}: {tech.licenseNumber} · Expiry: {tech.licenseExpiry}
                            </p>
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleRemoveTechnician(idx)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: 14,
                        padding: "18px 20px",
                        background: "#f8fafc",
                      }}
                    >
                      <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>+ Add Licensed Technician to Roster</h4>
                      <Grid columns="repeat(auto-fit, minmax(200px, 1fr))">
                        <Field
                          label="Technician Full Name"
                          value={newTechName}
                          onChange={setNewTechName}
                          placeholder="e.g. Jason Miller"
                        />

                        <Field
                          label="Technician Email"
                          value={newTechEmail}
                          onChange={setNewTechEmail}
                          placeholder="jason@mapleshield.test"
                          type="email"
                        />

                        <Field
                          label="Technician Mobile Phone"
                          value={newTechPhone}
                          onChange={setNewTechPhone}
                          placeholder="+14165550234"
                          type="tel"
                        />

                        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                          <span>Trade Specialization</span>
                          <select
                            value={newTechTrade}
                            onChange={(e) => setNewTechTrade(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "13px 16px",
                              borderRadius: 14,
                              border: "1px solid #cbd5e1",
                              fontSize: 14,
                            }}
                          >
                            {selectedTradeSlugs.map((s) => (
                              <option key={s} value={s}>
                                {s.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>

                        <Field
                          label="License Authority / Type"
                          value={newTechLicense}
                          onChange={setNewTechLicense}
                          placeholder="e.g. TSSA G1 Gas Fitter"
                        />

                        <Field
                          label="Official License Number"
                          value={newTechNumber}
                          onChange={setNewTechNumber}
                          placeholder="e.g. TSSA-G1-998822"
                        />
                      </Grid>

                      <div style={{ marginTop: 14 }}>
                        <Button variant="secondary" onClick={handleAddTechnician}>
                          + Add to Roster
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 4: Covenants, Insurance & Attestation */}
                {onboardingStep === 4 && (
                  <div style={{ display: "grid", gap: 18 }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>
                      Step 5: Statutory Covenants, WSIB, Insurance & Consent
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      Provide statutory workplace safety and general liability details. Attest to mandatory technician background check consents.
                    </p>

                    <Grid columns="repeat(auto-fit, minmax(240px, 1fr))">
                      <Field
                        label="WSIB Ontario Clearance / Account Number"
                        value={wsibNumber}
                        onChange={setWsibNumber}
                        placeholder="e.g. WSIB-ON-9811234"
                      />

                      <Field
                        label="Commercial General Liability (CGL) Policy Number"
                        value={cglPolicyNumber}
                        onChange={setCglPolicyNumber}
                        placeholder="e.g. INTACT-CGL-5M-449102"
                      />

                      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                        <span>CGL Coverage Amount ($5,000,000 Minimum)</span>
                        <input
                          type="number"
                          value={(cglCoverageAmountCents / 100).toFixed(0)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value || "0", 10);
                            setCglCoverageAmountCents(val * 100);
                          }}
                          style={{
                            width: "100%",
                            padding: "13px 16px",
                            borderRadius: 14,
                            border: "1px solid #cbd5e1",
                            fontSize: 14,
                          }}
                        />
                      </label>
                    </Grid>

                    <div
                      style={{
                        padding: "16px 20px",
                        background: "#fff",
                        borderRadius: 12,
                        border: "1px solid #cbd5e1",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={backgroundConsentAttested}
                          onChange={(e) => setBackgroundConsentAttested(e.target.checked)}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>
                          <strong>Technician Background Check Attestation:</strong> I certify that all technician members on the submitted roster have completed identity and criminal record screening or have authorized background checks in compliance with Ontario employment standards.
                        </span>
                      </label>

                      <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>
                          <strong>Master Service Provider Agreement & Safety Covenant:</strong> I accept the Skilled Hire platform terms, agree to the 365-day statutory workmanship warranty covenants, and commit to the fail-closed trade standards.
                        </span>
                      </label>
                    </div>

                    {/* Pre-submission Readiness Summary */}
                    <div
                      style={{
                        padding: "16px 20px",
                        borderRadius: 12,
                        background: computedReadiness.isReadyForReview ? "#f0fdf4" : "#fffbeb",
                        border: `1px solid ${computedReadiness.isReadyForReview ? "#bbf7d0" : "#fde68a"}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                          Accreditation Readiness: {computedReadiness.readinessScoreBps / 100}%
                        </span>
                        <Badge tone={computedReadiness.isReadyForReview ? "green" : "amber"}>
                          {computedReadiness.isReadyForReview ? "✓ Ready for Fast-Track Review" : "Requirements Pending"}
                        </Badge>
                      </div>
                      {computedReadiness.missingItems.length > 0 && (
                        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b45309" }}>
                          Missing: {computedReadiness.missingItems.join("; ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Wizard Footer Navigation */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 28,
                    paddingTop: 18,
                    borderTop: "1px solid #e2e8f0",
                  }}
                >
                  <Button
                    variant="secondary"
                    disabled={onboardingStep === 0}
                    onClick={() => setOnboardingStep((s) => Math.max(0, s - 1))}
                  >
                    ← Back
                  </Button>

                  <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                    Step {onboardingStep + 1} of 5
                  </span>

                  {onboardingStep < 4 ? (
                    <Button
                      variant="primary"
                      onClick={() => setOnboardingStep((s) => Math.min(4, s + 1))}
                    >
                      Next Step →
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={isSubmittingOnboarding}
                      onClick={handleSubmitApplication}
                    >
                      {isSubmittingOnboarding ? "Submitting..." : "Submit Application for Accreditation 🚀"}
                    </Button>
                  )}
                </div>
              </Card>
            </>
          )}

          {/* Resume Draft Modal */}
          <Modal
            isOpen={isResumeModalOpen}
            onClose={() => setIsResumeModalOpen(false)}
            title="Resume Saved Onboarding Draft"
          >
            <div style={{ display: "grid", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: "#475569" }}>
                Enter the save token provided when you saved your draft to restore your application progress.
              </p>
              <Field
                label="Draft Save Token (e.g. DFT-XXXXXX)"
                value={resumeTokenInput}
                onChange={setResumeTokenInput}
                placeholder="DFT-..."
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <Button variant="secondary" onClick={() => setIsResumeModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleResumeDraft}>
                  Load Application Draft
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </Shell>
  );
}
