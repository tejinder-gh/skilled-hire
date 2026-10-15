"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ComplianceEvaluationStatus,
  CredentialGroupCode,
  CredentialStatus,
  DispatchOfferDTO,
  EntityLevel,
  ProviderApplicationDTO,
  ProviderRateProposal,
  RecommendationDeclineReason,
  RecommendationResponseEventDTO,
  RecommendationStatus,
  RecommendationUrgency,
  ScheduleExceptionType,
  ServiceRecommendationDTO,
  SubmittedCredentialInput,
  TechnicianRosterInput,
  TechnicianScheduleDTO,
  TechnicianScheduleExceptionDTO,
  TechnicianServiceRegionDTO,
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
    "workspace" | "evidence" | "completion" | "warranty" | "compliance" | "onboarding" | "scheduling" | "recommendations"
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
  // Technician Service Recommendations State
  // ---------------------------------------------------------------------------
  const [recommendations, setRecommendations] = useState<ServiceRecommendationDTO[]>([
    {
      id: "rec-2026-4412-01",
      jobId: "JOB-2026-4412",
      serviceRequestId: "REQ-2026-9921",
      propertyId: "prop-king-123",
      customerId: "user-cust-avery",
      contractorId: "cont-mapleshield",
      technicianId: "tech-marcus",
      title: "Dual-Run Compressor & Fan Capacitor Replacement (45+5 µF)",
      description:
        "Measured outdoor condenser dual-run capacitor under load; capacitance has dropped from rated 45µF to 28.5µF (36% degradation). Motor is drawing excessive amps with elevated risk of hard-start failure and compressor winding damage during peak heat.",
      urgency: "URGENT_REPAIR",
      status: "PROPOSED",
      estimatedCostCents: 18500,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80",
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      technicianName: "Marcus Sterling (Lead Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "123 King Street W, Unit 1402, Toronto",
      responses: [
        {
          id: "resp-01",
          recommendationId: "rec-2026-4412-01",
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: "Discovered during routine multimeter check of compressor electrical components.",
          metadata: { estimatedCostCents: 18500, urgency: "URGENT_REPAIR" },
          createdAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: "rec-2026-4389-02",
      jobId: "JOB-2026-4389",
      serviceRequestId: "REQ-2026-9811",
      propertyId: "prop-queensway-88",
      customerId: "user-cust-sophia",
      contractorId: "cont-mapleshield",
      technicianId: "tech-marcus",
      title: "Condensate Drain Line Trap Flush & Float Switch Installation",
      description:
        "Condensate trap is coated in bacterial sludge and biofilm, causing slow drainage into floor drain. Recommended automated shutoff float switch to prevent future water damage.",
      urgency: "RECOMMENDED_MAINTENANCE",
      status: "ACCEPTED",
      estimatedCostCents: 14500,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=400&q=80",
      ],
      homeownerResponseNotes: "Approved immediately. Marcus completed the install during the service call.",
      respondedAt: "2026-10-12T15:10:00Z",
      createdAt: "2026-10-12T14:40:00Z",
      updatedAt: "2026-10-12T15:10:00Z",
      technicianName: "Marcus Sterling (Lead Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "88 Queensway Blvd, Etobicoke",
      responses: [
        {
          id: "resp-02-a",
          recommendationId: "rec-2026-4389-02",
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: "Discovered slow drainage while testing high-efficiency furnace condensate flow.",
          metadata: { estimatedCostCents: 14500 },
          createdAt: "2026-10-12T14:40:00Z",
        },
        {
          id: "resp-02-b",
          recommendationId: "rec-2026-4389-02",
          action: "ACCEPTED",
          actorId: "user-cust-sophia",
          actorRole: "CUSTOMER",
          notes: "Approved immediately. Marcus completed the install during the service call.",
          metadata: { decision: "ACCEPTED", convertedImmediately: true },
          createdAt: "2026-10-12T15:10:00Z",
        },
      ],
    },
    {
      id: "rec-2026-4251-03",
      jobId: "JOB-2026-4251",
      serviceRequestId: "REQ-2026-9705",
      propertyId: "prop-bay-410",
      customerId: "user-cust-michael",
      contractorId: "cont-mapleshield",
      technicianId: "tech-marcus",
      title: "Whole-Home Inline Sediment & Carbon Filtration Upgrade",
      description:
        "Municipal water test showed elevated sediment particles causing premature scale buildup in tankless water heater heat exchanger. Recommended 20-micron whole-home pre-filtration.",
      urgency: "UPGRADE_OPPORTUNITY",
      status: "DECLINED",
      estimatedCostCents: 65000,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=400&q=80",
      ],
      declineReason: "TOO_EXPENSIVE",
      homeownerResponseNotes: "Will consider next spring after bathroom remodeling budget is cleared.",
      respondedAt: "2026-10-08T11:20:00Z",
      createdAt: "2026-10-08T10:15:00Z",
      updatedAt: "2026-10-08T11:20:00Z",
      technicianName: "Marcus Sterling (Lead Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "410 Bay St, Toronto",
      responses: [
        {
          id: "resp-03-a",
          recommendationId: "rec-2026-4251-03",
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: "Proposed optional water filtration enhancement.",
          metadata: { estimatedCostCents: 65000 },
          createdAt: "2026-10-08T10:15:00Z",
        },
        {
          id: "resp-03-b",
          recommendationId: "rec-2026-4251-03",
          action: "DECLINED",
          actorId: "user-cust-michael",
          actorRole: "CUSTOMER",
          notes: "Will consider next spring after bathroom remodeling budget is cleared.",
          metadata: { decision: "DECLINED", declineReason: "TOO_EXPENSIVE" },
          createdAt: "2026-10-08T11:20:00Z",
        },
      ],
    },
  ]);

  const [isRecommendModalOpen, setIsRecommendModalOpen] = useState(false);
  const [selectedRecForDetail, setSelectedRecForDetail] = useState<ServiceRecommendationDTO | null>(null);
  const [recFilterStatus, setRecFilterStatus] = useState<string>("ALL");

  // Form fields for discovering & recommending a service on site
  const [newRecTitle, setNewRecTitle] = useState("");
  const [newRecDescription, setNewRecDescription] = useState("");
  const [newRecUrgency, setNewRecUrgency] = useState<RecommendationUrgency>("RECOMMENDED_MAINTENANCE");
  const [newRecCostDollars, setNewRecCostDollars] = useState("185.00");
  const [newRecPhotoUrl, setNewRecPhotoUrl] = useState("https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80");
  const [recFeedbackNotice, setRecFeedbackNotice] = useState<string | null>(null);

  const applyRecTemplate = (template: {
    title: string;
    description: string;
    urgency: RecommendationUrgency;
    cost: string;
    photo: string;
  }) => {
    setNewRecTitle(template.title);
    setNewRecDescription(template.description);
    setNewRecUrgency(template.urgency);
    setNewRecCostDollars(template.cost);
    setNewRecPhotoUrl(template.photo);
  };

  const handleCreateRecommendation = () => {
    if (!newRecTitle.trim() || !newRecDescription.trim()) {
      alert("Please enter a title and description for the recommendation.");
      return;
    }
    const costCents = Math.round(parseFloat(newRecCostDollars || "0") * 100);
    const newId = `rec-${Date.now()}`;
    const newRec: ServiceRecommendationDTO = {
      id: newId,
      jobId: "JOB-2026-4412",
      serviceRequestId: "REQ-2026-9921",
      propertyId: "prop-king-123",
      customerId: "user-cust-avery",
      contractorId: "cont-mapleshield",
      technicianId: "tech-marcus",
      title: newRecTitle.trim(),
      description: newRecDescription.trim(),
      urgency: newRecUrgency,
      status: "PROPOSED",
      estimatedCostCents: costCents,
      currency: "CAD",
      evidencePhotos: newRecPhotoUrl.trim() ? [newRecPhotoUrl.trim()] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      technicianName: "Marcus Sterling (Lead Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "123 King Street W, Unit 1402, Toronto",
      responses: [
        {
          id: `resp-${Date.now()}`,
          recommendationId: newId,
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: newRecDescription.trim(),
          metadata: { estimatedCostCents: costCents, urgency: newRecUrgency },
          createdAt: new Date().toISOString(),
        },
      ],
    };

    setRecommendations((prev) => [newRec, ...prev]);
    setIsRecommendModalOpen(false);
    setNewRecTitle("");
    setNewRecDescription("");
    setNewRecCostDollars("185.00");
    setRecFeedbackNotice(
      `✓ Successfully suggested "${newRec.title}" to homeowner Avery H. Real-time notification delivered with full transparency.`,
    );
    setTimeout(() => setRecFeedbackNotice(null), 7000);
  };

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

  // Field Evidence & Secure Storage Pipeline State (SH-04)
  const [evidencePhotos, setEvidencePhotos] = useState<
    Array<{
      id: string;
      label: string;
      type: "before" | "after";
      timestamp: string;
      scanStatus: "CLEAN" | "QUARANTINED" | "PENDING_SCAN";
      quarantineReason?: string | undefined;
      storageKey: string;
      signedUrl?: string | undefined;
    }>
  >([
    {
      id: "ev-1",
      label: "Diagnostic test: Burned dual-run capacitor contacts",
      type: "before",
      timestamp: "10:14 AM",
      scanStatus: "CLEAN",
      storageKey: "evidence/job_before_photo/cont-1/2026/10/a1b2c3d4e5f60718293a4b5c6d7e8f90.jpg",
      signedUrl: "http://localhost:4000/v1/files/raw/evidence%2Fjob_before_photo%2Fcont-1%2F2026%2F10%2Fa1b2c3d4e5f60718293a4b5c6d7e8f90.jpg?sig=valid",
    },
    {
      id: "ev-2",
      label: "Installed OEM Lennox 45/5 uF capacitor & secure wiring",
      type: "after",
      timestamp: "11:02 AM",
      scanStatus: "CLEAN",
      storageKey: "evidence/job_after_photo/cont-1/2026/10/b2c3d4e5f6a10718293a4b5c6d7e8f91.jpg",
      signedUrl: "http://localhost:4000/v1/files/raw/evidence%2Fjob_after_photo%2Fcont-1%2F2026%2F10%2Fb2c3d4e5f6a10718293a4b5c6d7e8f91.jpg?sig=valid",
    },
  ]);
  const [newPhotoLabel, setNewPhotoLabel] = useState("");
  const [newPhotoType, setNewPhotoType] = useState<"before" | "after">("before");
  const [fileUploadNotice, setFileUploadNotice] = useState<{
    tone: "info" | "success" | "warning" | "danger";
    title: string;
    message: string;
  } | null>(null);

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

  // SH-06: Technician Scheduling, Exceptions, Service Regions & Dispatch Offers State
  const [contractorSchedules, setContractorSchedules] = useState<TechnicianScheduleDTO[]>([
    { id: "sch-1", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true, createdAt: "", updatedAt: "" },
    { id: "sch-2", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", dayOfWeek: 2, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true, createdAt: "", updatedAt: "" },
    { id: "sch-3", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", dayOfWeek: 3, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true, createdAt: "", updatedAt: "" },
    { id: "sch-4", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", dayOfWeek: 4, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true, createdAt: "", updatedAt: "" },
    { id: "sch-5", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", dayOfWeek: 5, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true, createdAt: "", updatedAt: "" },
  ]);
  const [contractorRegions, setContractorRegions] = useState<TechnicianServiceRegionDTO[]>([
    { id: "sr-1", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", postalFsa: "M5V", maxTravelRadiusKm: 25, travelBufferMinutes: 30, active: true, createdAt: "", updatedAt: "" },
    { id: "sr-2", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", contractorId: "cont-1", postalFsa: "L4W", maxTravelRadiusKm: 30, travelBufferMinutes: 35, active: true, createdAt: "", updatedAt: "" },
  ]);
  const [contractorExceptions, setContractorExceptions] = useState<TechnicianScheduleExceptionDTO[]>([
    { id: "ex-1", technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002", exceptionType: "UNAVAILABLE", startDate: "2026-10-20", endDate: "2026-10-20", startTime: "13:00", endTime: "17:00", allDay: false, reason: "TSSA Safety Regulation & Code Update Seminar", createdAt: "", updatedAt: "" },
  ]);
  const [activeOffers, setActiveOffers] = useState<DispatchOfferDTO[]>([
    {
      id: "off-demo-1",
      serviceRequestId: "req-toronto-furnace-101",
      technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002",
      contractorId: "cont-1",
      candidateRank: 1,
      candidateScore: 98,
      status: "OFFERED",
      offeredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
      technicianName: "John S.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [offerToDecline, setOfferToDecline] = useState<DispatchOfferDTO | null>(null);
  const [declineReason, setDeclineReason] = useState("CREW_OVERLOAD");
  const [declineNotes, setDeclineNotes] = useState("Journeyperson committed on critical hospital chiller repair");
  const [newRegionFsa, setNewRegionFsa] = useState("M2N");
  const [newRegionRadius, setNewRegionRadius] = useState("25");
  const [newRegionBuffer, setNewRegionBuffer] = useState("30");
  const [newExType, setNewExType] = useState<ScheduleExceptionType>("TIME_OFF");
  const [newExStartDate, setNewExStartDate] = useState("2026-10-22");
  const [newExEndDate, setNewExEndDate] = useState("2026-10-22");
  const [newExStartTime, setNewExStartTime] = useState("08:00");
  const [newExEndTime, setNewExEndTime] = useState("17:00");
  const [newExReason, setNewExReason] = useState("Scheduled equipment van maintenance & inspection");
  const [schedulingFeedback, setSchedulingFeedback] = useState<string | null>(null);

  async function handleAcceptCurrentOffer(offerId?: string) {
    const targetId = offerId || activeOffers[0]?.id;
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok && targetId) {
        const { accessToken } = await loginRes.json();
        await fetch(`http://localhost:4000/v1/dispatch/offers/${targetId}/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ action: "ACCEPT" }),
        });
      }
    } catch {
      // Graceful offline fallback
    }
    setDispatchOfferAccepted(true);
    setCurrentStep(1);
    setActiveOffers((prev) =>
      prev.map((o) => (o.id === targetId ? { ...o, status: "ACCEPTED" } : o)),
    );
    setSchedulingFeedback("Dispatch offer accepted! Technician assigned and en route.");
  }

  async function handleConfirmDeclineOffer() {
    const targetId = offerToDecline?.id || activeOffers[0]?.id;
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok && targetId) {
        const { accessToken } = await loginRes.json();
        await fetch(`http://localhost:4000/v1/dispatch/offers/${targetId}/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: "DECLINE",
            declineReason,
            declineNotes,
          }),
        });
      }
    } catch {
      // Graceful offline fallback
    }
    setActiveOffers((prev) =>
      prev.map((o) =>
        o.id === targetId
          ? { ...o, status: "DECLINED", declineReason, declineNotes }
          : o,
      ),
    );
    setDeclineModalOpen(false);
    setSchedulingFeedback("Offer declined. Service request routed to Operations Fallback Queue.");
  }

  async function handleAddNewRegion() {
    if (!newRegionFsa) return;
    const regionObj: TechnicianServiceRegionDTO = {
      id: `sr-${Date.now()}`,
      technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002",
      contractorId: "cont-1",
      postalFsa: newRegionFsa.toUpperCase(),
      maxTravelRadiusKm: Number(newRegionRadius) || 25,
      travelBufferMinutes: Number(newRegionBuffer) || 30,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        await fetch(
          `http://localhost:4000/v1/dispatch/technicians/95def5e1-99d6-4f79-8db8-1aa0a2649002/service-regions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              postalFsa: regionObj.postalFsa,
              maxTravelRadiusKm: regionObj.maxTravelRadiusKm,
              travelBufferMinutes: regionObj.travelBufferMinutes,
            }),
          },
        );
      }
    } catch {
      // Graceful fallback
    }
    setContractorRegions((prev) => [...prev, regionObj]);
    setSchedulingFeedback(`Added service region FSA ${regionObj.postalFsa} with ${regionObj.travelBufferMinutes}m travel buffer.`);
  }

  async function handleAddNewException() {
    const exObj: TechnicianScheduleExceptionDTO = {
      id: `ex-${Date.now()}`,
      technicianId: "95def5e1-99d6-4f79-8db8-1aa0a2649002",
      exceptionType: newExType,
      startDate: newExStartDate,
      endDate: newExEndDate,
      startTime: newExStartTime,
      endTime: newExEndTime,
      allDay: false,
      reason: newExReason,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        await fetch(
          `http://localhost:4000/v1/dispatch/technicians/95def5e1-99d6-4f79-8db8-1aa0a2649002/exceptions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              exceptionType: exObj.exceptionType,
              startDate: exObj.startDate,
              endDate: exObj.endDate,
              startTime: exObj.startTime,
              endTime: exObj.endTime,
              allDay: exObj.allDay,
              reason: exObj.reason,
            }),
          },
        );
      }
    } catch {
      // Graceful fallback
    }
    setContractorExceptions((prev) => [...prev, exObj]);
    setSchedulingFeedback(`Logged ${newExType} exception for technician John S.`);
  }

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
            {
              value: "scheduling",
              label: "Technician Scheduling",
              icon: "📅",
              badge: activeOffers.filter((o) => o.status === "OFFERED").length ? `${activeOffers.filter((o) => o.status === "OFFERED").length} Offer` : undefined,
            },
            {
              value: "recommendations",
              label: "Recommended Services",
              icon: "💡",
              badge: `${recommendations.length} Tracked`,
            },
          ]}
        />
      </div>

      {schedulingFeedback && (
        <Callout tone="info" title="Dispatch & Scheduling Update">
          {schedulingFeedback}
        </Callout>
      )}

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
                  onClick={() => handleAcceptCurrentOffer()}
                >
                  ✓ Accept Dispatch Offer
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => {
                    setOfferToDecline(activeOffers[0] || null);
                    setDeclineModalOpen(true);
                  }}
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

              {/* Discovered Service Recommendations for Current Active Job */}
              <Card tone="white" padding="lg">
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
                      <span style={{ fontSize: 20 }}>💡</span>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                        Discovered Services & Recommendations
                      </h3>
                      <Badge tone="blue">
                        {recommendations.filter((r) => r.jobId === "JOB-2026-4412").length} Discovered
                      </Badge>
                    </div>
                    <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
                      Suggest repairs, safety remediations, or preventative upgrades discovered during on-site assessment. The homeowner can accept or decline with transparent pricing and full audit tracking.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setIsRecommendModalOpen(true)}
                  >
                    + Suggest Discovered Service
                  </Button>
                </div>

                {recFeedbackNotice && (
                  <div style={{ marginBottom: 16 }}>
                    <Callout tone="success" title="Recommendation Dispatched">
                      {recFeedbackNotice}
                    </Callout>
                  </div>
                )}

                <div style={{ display: "grid", gap: 12 }}>
                  {recommendations
                    .filter((r) => r.jobId === "JOB-2026-4412")
                    .map((rec) => (
                      <div
                        key={rec.id}
                        style={{
                          background: "#f8fafc",
                          borderRadius: 14,
                          padding: 16,
                          border: "1px solid #e2e8f0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: "1 1 300px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>
                              {rec.title}
                            </span>
                            <Badge
                              tone={
                                rec.urgency === "IMMEDIATE_SAFETY_HAZARD"
                                  ? "danger"
                                  : rec.urgency === "URGENT_REPAIR"
                                    ? "amber"
                                    : rec.urgency === "RECOMMENDED_MAINTENANCE"
                                      ? "blue"
                                      : "green"
                              }
                            >
                              {rec.urgency.replace(/_/g, " ")}
                            </Badge>
                            <Badge
                              tone={
                                rec.status === "ACCEPTED"
                                  ? "green"
                                  : rec.status === "DECLINED"
                                    ? "danger"
                                    : rec.status === "DEFERRED"
                                      ? "amber"
                                      : "neutral"
                              }
                            >
                              {rec.status === "PROPOSED"
                                ? "⏳ AWAITING HOMEOWNER RESPONSE"
                                : rec.status === "ACCEPTED"
                                  ? "✓ ACCEPTED BY HOMEOWNER"
                                  : rec.status === "DECLINED"
                                    ? `✕ DECLINED (${rec.declineReason ?? "NO REASON"})`
                                    : "DEFERRED"}
                            </Badge>
                          </div>
                          <p style={{ margin: "4px 0 6px", fontSize: 13, color: "#475569", lineHeight: 1.4 }}>
                            {rec.description}
                          </p>
                          {rec.homeownerResponseNotes && (
                            <p style={{ margin: "4px 0 0", fontSize: 12, fontStyle: "italic", color: "#334155" }}>
                              Homeowner Note: &ldquo;{rec.homeownerResponseNotes}&rdquo;
                            </p>
                          )}
                        </div>

                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <span style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                            ${(rec.estimatedCostCents / 100).toFixed(2)} <span style={{ fontSize: 12, fontWeight: 600 }}>CAD</span>
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedRecForDetail(rec)}
                          >
                            Inspect Audit Trail ({rec.responses?.length ?? 1})
                          </Button>
                        </div>
                      </div>
                    ))}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
              <div>
                <h2 style={{ fontSize: 22, margin: "0 0 6px" }}>
                  Field Photo Evidence Locker
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  Capture required diagnostic and completion photos. Evidence is cryptographically
                  anchored and verified through our private storage and anti-virus pipeline.
                </p>
              </div>
              <Badge tone="purple">SH-04 Storage Pipeline</Badge>
            </div>

            <div style={{ margin: "14px 0 20px" }}>
              <Callout tone="info" title="Zero-Trust File Evidence Pipeline">
                Files are strictly verified for true binary magic bytes (JPEG/PNG/PDF), checked against executable malware signatures, and delivered via time-bounded 15-minute expiring signed leases.
              </Callout>
            </div>

            {fileUploadNotice && (
              <div style={{ marginBottom: 18 }}>
                <Callout tone={fileUploadNotice.tone} title={fileUploadNotice.title}>
                  {fileUploadNotice.message}
                </Callout>
              </div>
            )}

            <Grid columns="repeat(auto-fill, minmax(300px, 1fr))">
              {evidencePhotos.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    border: `1.5px solid ${photo.scanStatus === "QUARANTINED" ? "#fca5a5" : "#e2e8f0"}`,
                    borderRadius: 16,
                    padding: 16,
                    background:
                      photo.scanStatus === "QUARANTINED"
                        ? "#fef2f2"
                        : photo.type === "before"
                          ? "#fffbeb"
                          : "#ecfdf5",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Badge tone={photo.type === "before" ? "amber" : "green"}>
                        {photo.type === "before" ? "BEFORE WORK" : "AFTER WORK"}
                      </Badge>
                      <Badge tone={photo.scanStatus === "CLEAN" ? "green" : photo.scanStatus === "QUARANTINED" ? "danger" : "amber"}>
                        {photo.scanStatus === "CLEAN" ? "✓ AV Clean" : photo.scanStatus === "QUARANTINED" ? "🚨 Quarantined" : "⏳ Pending Scan"}
                      </Badge>
                    </div>
                    <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                      {photo.timestamp}
                    </span>
                  </div>

                  <div
                    style={{
                      height: 120,
                      borderRadius: 12,
                      background: photo.scanStatus === "QUARANTINED" ? "#fee2e2" : "#e2e8f0",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 32,
                      marginBottom: 10,
                    }}
                  >
                    {photo.scanStatus === "QUARANTINED" ? "☣️" : "📷"}
                  </div>

                  <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {photo.label}
                  </p>

                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "#64748b", background: "#fff", padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", wordBreak: "break-all", marginBottom: 8 }}>
                    {photo.storageKey.split("/").slice(0, 3).join("/")}/.../{photo.storageKey.split("/").pop()}
                  </div>

                  {photo.scanStatus === "QUARANTINED" && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", display: "block" }}>
                        Quarantine Trigger:
                      </span>
                      <span style={{ fontSize: 11, color: "#991b1b" }}>
                        {photo.quarantineReason ?? "Executable signature or malware trap detected."}
                      </span>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {photo.scanStatus === "QUARANTINED" ? (
                      <Badge tone="danger">Downloads Blocked</Badge>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFileUploadNotice({
                            tone: "success",
                            title: "Signed Lease Active",
                            message: `Generated verified 15-minute download lease for ${photo.storageKey.split("/").pop()}. Access logged in immutable audit trail.`,
                          });
                        }}
                      >
                        Inspect Signed Lease
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </Grid>

            <div style={{ marginTop: 24, padding: 18, background: "#f8fafc", borderRadius: 16 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>
                Attach New Photo Evidence via Presigned Lease
              </h3>
              <div style={{ display: "grid", gap: 12 }}>
                <Field
                  label="Description / Diagnostic Finding"
                  placeholder="e.g. Suction line pressure gauge showing 118 PSI"
                  value={newPhotoLabel}
                  onChange={setNewPhotoLabel}
                />
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
                      const randomHex = Math.random().toString(16).slice(2, 10);
                      const key = `evidence/job_${newPhotoType}_photo/cont-1/2026/10/${randomHex}0123456789abcdef.jpg`;
                      setEvidencePhotos((prev) => [
                        ...prev,
                        {
                          id: `ev-${Date.now()}`,
                          label: newPhotoLabel.trim(),
                          type: newPhotoType,
                          timestamp: "Just now",
                          scanStatus: "CLEAN",
                          storageKey: key,
                          signedUrl: `http://localhost:4000/v1/files/raw/${encodeURIComponent(key)}?sig=valid`,
                        },
                      ]);
                      setFileUploadNotice({
                        tone: "success",
                        title: "Presigned Upload Finalized & Verified",
                        message: `Binary uploaded, magic bytes validated as image/jpeg, anti-virus scan passed CLEAN. Immutable SHA-256 checksum recorded.`,
                      });
                      setNewPhotoLabel("");
                    }}
                  >
                    + Presigned Upload & Scan
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!newPhotoLabel.trim()}
                    onClick={() => {
                      const randomHex = Math.random().toString(16).slice(2, 10);
                      const key = `evidence/job_${newPhotoType}_photo/cont-1/2026/10/${randomHex}malware_trap.pdf.exe`;
                      setEvidencePhotos((prev) => [
                        ...prev,
                        {
                          id: `ev-threat-${Date.now()}`,
                          label: `[SUSPICIOUS] ${newPhotoLabel.trim()}`,
                          type: newPhotoType,
                          timestamp: "Just now",
                          scanStatus: "QUARANTINED",
                          quarantineReason: "DoubleExtensionExecutableTrap: Dangerous executable extension '.exe' detected",
                          storageKey: key,
                        },
                      ]);
                      setFileUploadNotice({
                        tone: "danger",
                        title: "Malware Detected & File Quarantined",
                        message: "The uploaded payload contained a suspicious executable signature. It has been immediately quarantined; customer and contractor access is strictly blocked.",
                      });
                      setNewPhotoLabel("");
                    }}
                  >
                    ☣️ Simulate Threat Quarantine Drill
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

      {/* -------------------------------------------------------------
          TAB 7: TECHNICIAN SCHEDULING & DISPATCH OFFERS (SH-06)
         ------------------------------------------------------------- */}
      {activeTab === "scheduling" && (
        <div style={{ display: "grid", gap: 24 }}>
          {/* Scheduling KPI Banner */}
          <Grid columns="repeat(4, minmax(0, 1fr))">
            <Card>
              <Metric label="Weekly Working Days" value={String(contractorSchedules.filter((s) => s.active).length)} detail="Mon–Fri 08:00–18:00" />
            </Card>
            <Card>
              <Metric label="Service FSA Zones" value={String(contractorRegions.length)} detail="M5V, L4W covered" />
            </Card>
            <Card>
              <Metric label="Schedule Exceptions" value={String(contractorExceptions.length)} detail="Active time-off" />
            </Card>
            <Card>
              <Metric
                label="Incoming Offers"
                value={String(activeOffers.filter((o) => o.status === "OFFERED").length)}
                detail="15-min SLA response"
              />
            </Card>
          </Grid>

          {/* Section 1: Live Dispatch Offers Console */}
          <Card tone={activeOffers.some((o) => o.status === "OFFERED") ? "amber" : "white"} padding="lg">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h2 style={{ margin: "0 0 4px" }}>Incoming Dispatch Offers Console</h2>
                  <Badge tone={activeOffers.some((o) => o.status === "OFFERED") ? "amber" : "neutral"}>
                    {activeOffers.filter((o) => o.status === "OFFERED").length} Action Required
                  </Badge>
                </div>
                <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                  Algorithmic dispatch offers ranked by proximity, TSSA certification tier, and customer satisfaction score.
                </p>
              </div>
              <Status tone={activeOffers.some((o) => o.status === "OFFERED") ? "amber" : "green"}>
                {activeOffers.some((o) => o.status === "OFFERED") ? "Active Offers Waiting" : "Offers In Sync"}
              </Status>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {activeOffers.map((offer) => (
                <div
                  key={offer.id}
                  style={{
                    padding: "16px 18px",
                    borderRadius: 14,
                    border: "1px solid #e2e8f0",
                    background: offer.status === "OFFERED" ? "#fffbeb" : "#f8fafc",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Badge tone="blue">Rank #{offer.candidateRank}</Badge>
                      <Badge tone="green">Score: {offer.candidateScore}/100</Badge>
                      <strong style={{ fontSize: 14, color: "#0f172a" }}>
                        Offer #{offer.id.slice(0, 8)} · Lead #{offer.serviceRequestId.slice(0, 8).toUpperCase()}
                      </strong>
                    </div>
                    <div style={{ fontSize: 13, color: "#334155" }}>
                      Assigned Technician: <strong>{offer.technicianName || "John S."}</strong> · Window: Preferred Today 1:00–3:00 PM
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                      Expires: {new Date(offer.expiresAt).toLocaleTimeString()} · Status: <strong>{offer.status}</strong>
                      {offer.declineReason ? ` (Reason: ${offer.declineReason})` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Status tone={offer.status === "OFFERED" ? "amber" : offer.status === "ACCEPTED" ? "green" : "neutral"}>
                      {offer.status}
                    </Status>
                    {offer.status === "OFFERED" && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAcceptCurrentOffer(offer.id)}
                        >
                          ✓ Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setOfferToDecline(offer);
                            setDeclineModalOpen(true);
                          }}
                        >
                          Decline & Pass
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Section 2: Weekly Shift Availability & Working Hours */}
          <Grid columns="minmax(0, 1.1fr) minmax(320px, 0.9fr)">
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px" }}>Technician Weekly Working Hours</h3>
                  <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                    Technician: <strong>John S.</strong> · Timezone: <strong>America/Toronto</strong>
                  </p>
                </div>
                <Badge tone="green">Emergency On-Call Active</Badge>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {contractorSchedules.map((sch) => {
                  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                  return (
                    <div
                      key={sch.id || sch.dayOfWeek}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #e2e8f0",
                        background: sch.active ? "#f8fafc" : "#f1f5f9",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>
                        {dayNames[sch.dayOfWeek]}
                      </div>
                      <div style={{ fontSize: 13, color: "#334155", display: "flex", alignItems: "center", gap: 10 }}>
                        <span>{sch.startTime} – {sch.endTime}</span>
                        <Badge tone={sch.active ? "green" : "neutral"}>
                          {sch.active ? "Working Shift" : "Off Duty"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Section 3: Service Regions & Travel Buffer Constraints */}
            <Card tone="blue">
              <h3 style={{ marginTop: 0 }}>Service Regions & Travel Buffers</h3>
              <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 13 }}>
                Automatic dispatch conflict control requires travel buffers between jobs based on technician territory.
              </p>

              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {contractorRegions.map((reg) => (
                  <div
                    key={reg.id || reg.postalFsa}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#fff",
                      border: "1px solid #bfdbfe",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 13, color: "#1e3a8a" }}>FSA {reg.postalFsa}</strong>
                      <span style={{ fontSize: 12, color: "#475569", marginLeft: 6 }}>
                        (Max {reg.maxTravelRadiusKm} km radius)
                      </span>
                    </div>
                    <Badge tone="blue">±{reg.travelBufferMinutes} min buffer</Badge>
                  </div>
                ))}
              </div>

              <div style={{ background: "#fff", padding: "12px 14px", borderRadius: 10, border: "1px solid #cbd5e1" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Add Service Territory</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Postal FSA</label>
                    <input
                      type="text"
                      maxLength={3}
                      value={newRegionFsa}
                      onChange={(e) => setNewRegionFsa(e.target.value.toUpperCase())}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Radius (km)</label>
                    <input
                      type="number"
                      value={newRegionRadius}
                      onChange={(e) => setNewRegionRadius(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Buffer (min)</label>
                    <input
                      type="number"
                      value={newRegionBuffer}
                      onChange={(e) => setNewRegionBuffer(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                    />
                  </div>
                </div>
                <Button size="sm" onClick={handleAddNewRegion}>
                  Add Region & Buffer
                </Button>
              </div>
            </Card>
          </Grid>

          {/* Section 4: Schedule Exceptions & Time-Off Management */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Schedule Exceptions & Approved Time-Off</h3>
                <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                  Pre-planned vacations, sick leaves, and mandatory technical training automatically block dispatch conflicts.
                </p>
              </div>
              <Status tone="blue">{contractorExceptions.length} Logged</Status>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
              {contractorExceptions.map((ex) => (
                <div
                  key={ex.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Badge tone={ex.exceptionType === "UNAVAILABLE" ? "blue" : ex.exceptionType === "TIME_OFF" ? "purple" : "amber"}>
                        {ex.exceptionType}
                      </Badge>
                      <strong style={{ fontSize: 13, color: "#0f172a" }}>{ex.reason || "Scheduled exception"}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      From: {ex.startDate} {ex.startTime || ""} — To: {ex.endDate} {ex.endTime || ""}
                    </div>
                  </div>
                  <Badge tone="neutral">Slot Blocked</Badge>
                </div>
              ))}
            </div>

            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Schedule Time-Off / Exception</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                    Exception Type
                  </label>
                  <select
                    value={newExType}
                    onChange={(e) => setNewExType(e.target.value as ScheduleExceptionType)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                  >
                    <option value="TIME_OFF">Time Off (Vacation / Personal)</option>
                    <option value="UNAVAILABLE">Unavailable (Mandatory Training / Leave)</option>
                    <option value="OVERTIME">Overtime Shift</option>
                    <option value="CUSTOM_HOURS">Custom Working Hours</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                    Date (YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    value={newExStartDate}
                    onChange={(e) => {
                      setNewExStartDate(e.target.value);
                      setNewExEndDate(e.target.value);
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={newExStartTime}
                    onChange={(e) => setNewExStartTime(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                    End Time
                  </label>
                  <input
                    type="time"
                    value={newExEndTime}
                    onChange={(e) => setNewExEndTime(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
              </div>
              <Field
                label="Reason / Documentation"
                value={newExReason}
                onChange={setNewExReason}
                hint="Recorded in contractor regulatory compliance history"
              />
              <div style={{ marginTop: 12 }}>
                <Button onClick={handleAddNewException}>
                  Log Exception & Block Conflicts
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 8: RECOMMENDED SERVICES & HOMEOWNER RESPONSE ANALYTICS
         ------------------------------------------------------------- */}
      {activeTab === "recommendations" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Executive Overview & Conversion Metrics */}
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
                  <Status tone="green">Field Discovery & Upsell Ledger</Status>
                  <Badge tone="blue">Ontario Certified Trades</Badge>
                </div>
                <h2 style={{ fontSize: 26, margin: "8px 0 4px" }}>
                  Technician Service Recommendations & Response Tracking
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  Comprehensive audit trail of on-site repairs, safety remediations, and upgrades discovered during active visits. Real-time visibility into homeowner acceptance, structured decline reasons, and dispatch conversion.
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => setIsRecommendModalOpen(true)}
              >
                + Suggest Discovered Service
              </Button>
            </div>

            <Grid columns="repeat(auto-fit, minmax(220px, 1fr))">
              <Card padding="sm">
                <Metric
                  label="Total Discovered Services"
                  value={`${recommendations.length} Services`}
                  detail="Identified on site during diagnostics"
                />
              </Card>
              <Card padding="sm">
                <Metric
                  label="Homeowner Acceptance Rate"
                  value={`${
                    recommendations.filter((r) => r.status === "ACCEPTED").length > 0
                      ? Math.round(
                          (recommendations.filter((r) => r.status === "ACCEPTED").length /
                            (recommendations.filter((r) => r.status === "ACCEPTED" || r.status === "DECLINED").length || 1)) *
                            100,
                        )
                      : 0
                  }%`}
                  detail="High-trust verified diagnostic conversions"
                />
              </Card>
              <Card padding="sm">
                <Metric
                  label="Approved Incremental Revenue"
                  value={`$${(
                    recommendations
                      .filter((r) => r.status === "ACCEPTED")
                      .reduce((acc, curr) => acc + curr.estimatedCostCents, 0) / 100
                  ).toFixed(2)} CAD`}
                  detail="Net billable additional scope"
                />
              </Card>
              <Card padding="sm">
                <Metric
                  label="Pending Homeowner Decisions"
                  value={`${recommendations.filter((r) => r.status === "PROPOSED").length} Pending`}
                  detail={`$${(
                    recommendations
                      .filter((r) => r.status === "PROPOSED")
                      .reduce((acc, curr) => acc + curr.estimatedCostCents, 0) / 100
                  ).toFixed(2)} CAD in review`}
                />
              </Card>
            </Grid>
          </Card>

          {/* Filter Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["ALL", "PROPOSED", "ACCEPTED", "DECLINED", "DEFERRED"].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setRecFilterStatus(filter)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 9999,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    border: "1px solid #cbd5e1",
                    background: recFilterStatus === filter ? "#1d4ed8" : "#ffffff",
                    color: recFilterStatus === filter ? "#ffffff" : "#334155",
                    transition: "all 0.15s ease",
                  }}
                >
                  {filter === "ALL"
                    ? `All (${recommendations.length})`
                    : filter === "PROPOSED"
                      ? `Pending Review (${recommendations.filter((r) => r.status === "PROPOSED").length})`
                      : filter === "ACCEPTED"
                        ? `Accepted (${recommendations.filter((r) => r.status === "ACCEPTED").length})`
                        : filter === "DECLINED"
                          ? `Declined (${recommendations.filter((r) => r.status === "DECLINED").length})`
                          : `Deferred (${recommendations.filter((r) => r.status === "DEFERRED").length})`}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              Showing {recommendations.filter((r) => recFilterStatus === "ALL" || r.status === recFilterStatus).length} records
            </span>
          </div>

          {/* Recommendations Feed */}
          <div style={{ display: "grid", gap: 14 }}>
            {recommendations
              .filter((r) => recFilterStatus === "ALL" || r.status === recFilterStatus)
              .map((rec) => (
                <Card key={rec.id} tone="white" padding="lg">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 16,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>
                          {rec.title}
                        </span>
                        <Badge
                          tone={
                            rec.urgency === "IMMEDIATE_SAFETY_HAZARD"
                              ? "danger"
                              : rec.urgency === "URGENT_REPAIR"
                                ? "amber"
                                : rec.urgency === "RECOMMENDED_MAINTENANCE"
                                  ? "blue"
                                  : "green"
                          }
                        >
                          {rec.urgency.replace(/_/g, " ")}
                        </Badge>
                        <Badge tone="neutral">{rec.jobId}</Badge>
                        <Badge
                          tone={
                            rec.status === "ACCEPTED"
                              ? "green"
                              : rec.status === "DECLINED"
                                ? "danger"
                                : rec.status === "DEFERRED"
                                  ? "amber"
                                  : "blue"
                          }
                        >
                          {rec.status === "PROPOSED"
                            ? "⏳ PENDING HOMEOWNER"
                            : rec.status === "ACCEPTED"
                              ? "✓ ACCEPTED"
                              : rec.status === "DECLINED"
                                ? "✕ DECLINED"
                                : "DEFERRED"}
                        </Badge>
                      </div>

                      <p style={{ margin: "0 0 6px", fontSize: 13, color: "#64748b" }}>
                        📍 {rec.propertyAddress || "Toronto, ON"} · Customer: {rec.customerId} · Suggested by: {rec.technicianName}
                      </p>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                        Estimated Price
                      </span>
                      <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
                        ${(rec.estimatedCostCents / 100).toFixed(2)} <span style={{ fontSize: 13, fontWeight: 600 }}>CAD</span>
                      </p>
                    </div>
                  </div>

                  <p style={{ margin: "0 0 14px", fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
                    {rec.description}
                  </p>

                  {/* Evidence Photos Preview */}
                  {rec.evidencePhotos && rec.evidencePhotos.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                        On-Site Evidence Photos ({rec.evidencePhotos.length})
                      </span>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {rec.evidencePhotos.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt="Discovered on-site evidence"
                            style={{
                              width: 100,
                              height: 70,
                              objectFit: "cover",
                              borderRadius: 8,
                              border: "1px solid #cbd5e1",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Decision Status Callout */}
                  {rec.status === "ACCEPTED" && (
                    <div style={{ marginBottom: 14 }}>
                      <Callout tone="success" title={`Homeowner Approved (${rec.respondedAt ? new Date(rec.respondedAt).toLocaleDateString() : "Recent"})`}>
                        {rec.homeownerResponseNotes
                          ? `Homeowner Note: "${rec.homeownerResponseNotes}"`
                          : "Homeowner accepted the recommended service without additional notes. Work order updated."}
                      </Callout>
                    </div>
                  )}

                  {rec.status === "DECLINED" && (
                    <div style={{ marginBottom: 14 }}>
                      <Callout tone="danger" title={`Homeowner Declined (${rec.declineReason ?? "No reason specified"})`}>
                        {rec.homeownerResponseNotes
                          ? `Homeowner Feedback: "${rec.homeownerResponseNotes}"`
                          : "Homeowner elected not to proceed with this service at this time. Preserved in Property Service Passport."}
                      </Callout>
                    </div>
                  )}

                  {rec.status === "DEFERRED" && (
                    <div style={{ marginBottom: 14 }}>
                      <Callout tone="warning" title="Follow-up Reminder Scheduled">
                        Homeowner requested a follow-up reminder in 60 days before the seasonal temperature transition.
                      </Callout>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      Created: {new Date(rec.createdAt).toLocaleString()}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedRecForDetail(rec)}
                    >
                      Inspect Audit Trail & Response Events ({rec.responses?.length ?? 1}) →
                    </Button>
                  </div>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Suggest Discovered Service Modal (Technician / Contractor) */}
      <Modal
        isOpen={isRecommendModalOpen}
        onClose={() => setIsRecommendModalOpen(false)}
        title="Suggest Discovered Service (On-Site Task)"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            Record an additional service, hazard remediation, or preventative maintenance discovered during the diagnostic visit. The homeowner will be notified to review and accept or decline with transparent pricing.
          </p>

          {/* Quick Templates Bar */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>
              Quick Inspection Templates
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() =>
                  applyRecTemplate({
                    title: "Dual-Run Compressor & Fan Capacitor Replacement (45+5 µF)",
                    description:
                      "Measured capacitance dropped from rated 45µF to 28.5µF under multimeter microfarad load test (36% drop). Elevated risk of compressor hard-start failure and stator winding overheating.",
                    urgency: "URGENT_REPAIR",
                    cost: "185.00",
                    photo: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80",
                  })
                }
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ⚡ Capacitor Degraded
              </button>
              <button
                type="button"
                onClick={() =>
                  applyRecTemplate({
                    title: "Main Brass Shutoff Valve Replacement",
                    description:
                      "Primary incoming municipal gate valve is heavily corroded with calcium oxidation and will not seat shut. Immediate risk of inability to isolate water supply during plumbing emergency.",
                    urgency: "IMMEDIATE_SAFETY_HAZARD",
                    cost: "320.00",
                    photo: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=400&q=80",
                  })
                }
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                🚰 Corroded Shutoff Valve
              </button>
              <button
                type="button"
                onClick={() =>
                  applyRecTemplate({
                    title: "Condensate Drain Line Trap Flush & Float Switch",
                    description:
                      "Condensate trap coated in biological slime causing slow outflow. Recommend installing automated float switch to shut off HVAC system before overflow causes drywall ceiling damage.",
                    urgency: "RECOMMENDED_MAINTENANCE",
                    cost: "145.00",
                    photo: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=400&q=80",
                  })
                }
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ❄️ Condensate Drain Flush
              </button>
              <button
                type="button"
                onClick={() =>
                  applyRecTemplate({
                    title: "Type 2 Whole-Home Electrical Panel Surge Protective Device (SPD)",
                    description:
                      "Electrical distribution panel lacks whole-home surge suppression. Protect sensitive inverter HVAC control boards, heat pump compressors, and high-value appliances from utility surges.",
                    urgency: "UPGRADE_OPPORTUNITY",
                    cost: "395.00",
                    photo: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80",
                  })
                }
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                🛡️ Panel Surge Protection
              </button>
            </div>
          </div>

          <Field
            label="Service Title"
            value={newRecTitle}
            onChange={setNewRecTitle}
            placeholder="e.g. Dual-Run Capacitor Replacement"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                Urgency / Severity Level
              </label>
              <select
                value={newRecUrgency}
                onChange={(e) => setNewRecUrgency(e.target.value as RecommendationUrgency)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              >
                <option value="IMMEDIATE_SAFETY_HAZARD">🚨 Immediate Safety Hazard</option>
                <option value="URGENT_REPAIR">⚠️ Urgent Repair Needed</option>
                <option value="RECOMMENDED_MAINTENANCE">🔧 Recommended Maintenance</option>
                <option value="UPGRADE_OPPORTUNITY">✨ Upgrade / Efficiency Improvement</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                Estimated Price ($ CAD)
              </label>
              <input
                type="number"
                step="0.01"
                value={newRecCostDollars}
                onChange={(e) => setNewRecCostDollars(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          <Field
            label="Detailed Technician Findings & Notes"
            value={newRecDescription}
            onChange={setNewRecDescription}
            multiline
            placeholder="Describe what was discovered during the task, why this service is required, and what happens if left unaddressed."
          />

          <Field
            label="Evidence Photo Key or URL"
            value={newRecPhotoUrl}
            onChange={setNewRecPhotoUrl}
            placeholder="https://... or uploaded S3 key"
            hint="Provides photographic proof directly to homeowner"
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setIsRecommendModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateRecommendation}>
              Submit & Send to Homeowner
            </Button>
          </div>
        </div>
      </Modal>

      {/* Inspect Audit Trail Modal */}
      <Modal
        isOpen={selectedRecForDetail !== null}
        onClose={() => setSelectedRecForDetail(null)}
        title="Recommendation Audit Trail & Homeowner Response History"
      >
        {selectedRecForDetail && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: 16 }}>{selectedRecForDetail.title}</strong>
                <Badge
                  tone={
                    selectedRecForDetail.status === "ACCEPTED"
                      ? "green"
                      : selectedRecForDetail.status === "DECLINED"
                        ? "danger"
                        : "amber"
                  }
                >
                  {selectedRecForDetail.status}
                </Badge>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                Job: {selectedRecForDetail.jobId} · Est: ${(selectedRecForDetail.estimatedCostCents / 100).toFixed(2)} CAD
              </p>
            </div>

            <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Technician Findings
              </span>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#1e293b" }}>
                {selectedRecForDetail.description}
              </p>
            </div>

            <div>
              <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Event History & Response Ledger</h4>
              <div style={{ display: "grid", gap: 8 }}>
                {(selectedRecForDetail.responses ?? []).map((resp, i) => (
                  <div
                    key={resp.id || i}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      background:
                        resp.action === "ACCEPTED"
                          ? "#f0fdf4"
                          : resp.action === "DECLINED"
                            ? "#fef2f2"
                            : "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Badge
                          tone={
                            resp.action === "ACCEPTED"
                              ? "green"
                              : resp.action === "DECLINED"
                                ? "danger"
                                : "blue"
                          }
                        >
                          {resp.action}
                        </Badge>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                          {resp.actorRole}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        {new Date(resp.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {resp.notes && (
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#475569" }}>
                        {resp.notes}
                      </p>
                    )}
                    {resp.metadata && Object.keys(resp.metadata).length > 0 && (
                      <pre style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: 6, borderRadius: 6, overflowX: "auto" }}>
                        {JSON.stringify(resp.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <Button variant="secondary" onClick={() => setSelectedRecForDetail(null)}>
                Close Audit View
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Decline Offer Modal */}
      <Modal
        isOpen={declineModalOpen}
        onClose={() => setDeclineModalOpen(false)}
        title="Decline Dispatch Offer"
      >
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
            Declining releases the atomic slot hold and immediately transfers the lead to the Operations Fallback Queue.
          </p>

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
              Decline Reason Code
            </label>
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
              }}
            >
              <option value="CREW_OVERLOAD">Crew Overload / Capacity Saturated</option>
              <option value="OUTSIDE_SERVICE_RADIUS">Outside Service Radius</option>
              <option value="EQUIPMENT_MISSING">Specialized Diagnostic Equipment Missing</option>
              <option value="SCHEDULE_CONFLICT">Direct Emergency Schedule Conflict</option>
              <option value="STAFFING_DEFICIT">Apprentice / Supervision Requirement Unfulfilled</option>
            </select>
          </div>

          <Field
            label="Internal Contractor Notes"
            value={declineNotes}
            onChange={setDeclineNotes}
            multiline
            hint="Details provided to marketplace operations team"
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setDeclineModalOpen(false)}>
              Keep Offer
            </Button>
            <Button variant="primary" onClick={handleConfirmDeclineOffer}>
              Confirm Decline & Pass
            </Button>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}
