"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AlternativeSlot,
  BookingDraftDTO,
  BookingReceiptDTO,
  CancellationQuoteResponse,
  CancellationPolicyType,
  CancellationReason,
  CustomerProfileDTO,
  CustomerPropertyDTO,
  CustomerRecoveryChoiceType,
  CustomerServiceCreditDTO,
  DispatchExceptionSeverity,
  DispatchExceptionStatus,
  DispatchExceptionType,
  NotificationChannel,
  NotificationPreferenceCategory,
  OutboxStatus,
  PropertyType,
  RecommendationDeclineReason,
  RecommendationResponseEventDTO,
  RecommendationStatus,
  RecommendationUrgency,
  ServiceRecommendationDTO,
  SlotAvailabilityResponse,
} from "@marketplace/contracts";
import {
  ONTARIO_LABOUR_ONLY_DISCLAIMER,
  EMERGENCY_SAFETY_DESK_PHONE,
  MASKED_COMMUNICATIONS_CONSENT,
} from "@marketplace/contracts";
import { screenMessageContent, maskPhoneNumber } from "@marketplace/core/messaging";
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
import {
  CANONICAL_TRADE_CATALOG,
  evaluateCancellationPolicy,
} from "@marketplace/vertical-engine";

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
  guaranteed?: boolean | undefined;
  availableCapacity?: number | undefined;
  confidence?: "HIGH" | "LIMITED" | "NONE" | undefined;
  badge?: string | undefined;
};

type EquipmentItem = {
  id: string;
  verticalId: string;
  name: string;
  assetType: string;
  manufacturer?: string | undefined;
  modelNumber?: string | undefined;
  serialNumber?: string | undefined;
  warrantyStatus: "ACTIVE" | "EXPIRED" | "UNKNOWN" | "EXTENDED";
  installedOn?: string | undefined;
};

export default function CustomerHome() {
  const [activeTab, setActiveTab] = useState<
    | "book"
    | "tracking"
    | "quotes"
    | "messages"
    | "completion"
    | "warranty"
    | "survey"
    | "security"
    | "payments"
    | "preferences"
  >("book");

  // --- CUSTOMER-TECHNICIAN MESSAGING & MASKED COMMUNICATIONS (SH-14 / #15) ---
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      senderRole: "CUSTOMER" | "TECHNICIAN" | "OPERATIONS_AGENT";
      senderDisplayName: string;
      content: string;
      attachmentKeys: string[];
      status: "SENT" | "DELIVERED" | "READ";
      moderationStatus: "APPROVED" | "FLAGGED" | "CLEAN" | "BLOCKED";
      moderationReason: string | null;
      createdAt: string;
      deliveredAt: string | null;
      readAt: string | null;
    }>
  >([
    {
      id: "msg-demo-1",
      senderRole: "CUSTOMER",
      senderDisplayName: "Sarah Jenkins",
      content:
        "Hello Marcus, I unlocked the side gate. The key code for the basement door is #4819. Please let me know once you arrive.",
      attachmentKeys: ["evidence/side-gate-path.jpg"],
      status: "READ",
      moderationStatus: "APPROVED",
      moderationReason: null,
      createdAt: "10:14 AM",
      deliveredAt: "10:14 AM",
      readAt: "10:15 AM",
    },
    {
      id: "msg-demo-2",
      senderRole: "TECHNICIAN",
      senderDisplayName: "Marcus Vance",
      content:
        "Thanks Sarah! I am 12 minutes away in my service van with the diagnostic manifold and replacement run capacitor. Will ring the bell before entering.",
      attachmentKeys: [],
      status: "READ",
      moderationStatus: "APPROVED",
      moderationReason: null,
      createdAt: "10:16 AM",
      deliveredAt: "10:16 AM",
      readAt: "10:17 AM",
    },
  ]);
  const [messageInput, setMessageInput] = useState("");
  const [messageAttachments, setMessageAttachments] = useState<string[]>([]);
  const [isMaskedBridgeModalOpen, setIsMaskedBridgeModalOpen] = useState(false);
  const [jobMessagingClosed, setJobMessagingClosed] = useState(false);
  const [moderationAlert, setModerationAlert] = useState<{
    status: "FLAGGED" | "APPROVED";
    reasons: string[];
  } | null>(null);

  const maskedSessionData = useMemo(
    () => ({
      virtualProxyNumber: "+1 (647) 555-0199",
      sessionExtension: "1042",
      sessionPin: "4819",
      technicianMaskedPhone: maskPhoneNumber("+16475550192"),
      customerMaskedPhone: maskPhoneNumber("+14165550198"),
      emergencyDirectPhone: EMERGENCY_SAFETY_DESK_PHONE,
      consentNotice: MASKED_COMMUNICATIONS_CONSENT,
      expiresIn: "48 hours remaining (Active Job Window)",
    }),
    [],
  );

  const unreadMessagesCount = useMemo(
    () =>
      messages.filter(
        (m) => m.senderRole !== "CUSTOMER" && m.status !== "READ",
      ).length,
    [messages],
  );

  // --- QUOTE REVIEW, CALL-OUT FEE & LABOUR-ONLY MATERIALS (SH-12 / #13) ---
  const [activeQuote, setActiveQuote] = useState({
    id: "quote-ontario-hvac-8819",
    jobId: "job-88194",
    bookingRef: "REQ-2026-9921",
    version: 1,
    status: "SUBMITTED" as "SUBMITTED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED",
    technicianName: "Marcus Vance",
    technicianTrade: "313A Refrigeration & Air Conditioning Systems Mechanic",
    technicianLicense: "ON-TSSA-FS-771249 / 309A-38910",
    diagnosticFeeCents: 12900,
    laborSubtotalCents: 24000,
    materialsSubtotalCents: 8500,
    disposalSubtotalCents: 4500,
    permitsSubtotalCents: 6000,
    platformFeeCents: 1000,
    taxCents: 6747, // 13% Ontario HST
    customerTotalCents: 63647,
    customerSuppliedPartsCaveat: ONTARIO_LABOUR_ONLY_DISCLAIMER,
    customerSuppliedAcknowledged: false,
    declineReason: null as string | null,
    declinedAt: null as string | null,
    items: [
      {
        id: "item-1",
        type: "DIAGNOSTIC",
        title: "Comprehensive On-Site Diagnostic Assessment & Multimeter Test",
        description:
          "Systematic multimeter assessment, dual capacitor load testing, compressor winding check, and static refrigerant pressure measurement.",
        quantity: 1,
        unitPriceCents: 12900,
        subtotalCents: 12900,
        isCustomerSupplied: false,
        warrantyCaveat: null,
      },
      {
        id: "item-2",
        type: "LABOUR",
        title: "Dual Run Capacitor Replacement & Low-Voltage Smart Control Wiring",
        description:
          "Safe electrical isolation (ESA compliant), installation of run capacitor, wire terminal crimping, and thermostat control board integration.",
        quantity: 2,
        unitPriceCents: 12000,
        subtotalCents: 24000,
        isCustomerSupplied: false,
        warrantyCaveat: "Covered by 365-day Skilled Hire workmanship guarantee.",
      },
      {
        id: "item-3",
        type: "MATERIAL",
        title: "Titan HD 45/5 MFD 440V Round Dual Run Motor Capacitor (OEM)",
        description:
          "North American made, 60,000-hour operational life rating, OEM direct replacement for Lennox AC condenser.",
        quantity: 1,
        unitPriceCents: 8500,
        subtotalCents: 8500,
        isCustomerSupplied: false,
        warrantyCaveat: "5-Year manufacturer parts warranty.",
      },
      {
        id: "item-4",
        type: "MATERIAL",
        title: "Ecobee Smart Thermostat Premium with SmartSensor (Customer-Supplied)",
        description:
          "Homeowner-provided hardware unit. Verified unopened original packaging on-site before installation.",
        quantity: 1,
        unitPriceCents: 0,
        subtotalCents: 0,
        isCustomerSupplied: true,
        warrantyCaveat:
          "Labour only warranty; customer assumes part defect risk under Ontario CPA & TSSA.",
      },
      {
        id: "item-5",
        type: "DISPOSAL",
        title: "Environmentally Certified Hazardous Capacitor & Waste Disposal",
        description:
          "Safe recycling and disposal in compliance with Ontario Environmental Protection Act guidelines.",
        quantity: 1,
        unitPriceCents: 4500,
        subtotalCents: 4500,
        isCustomerSupplied: false,
        warrantyCaveat: null,
      },
      {
        id: "item-6",
        type: "PERMIT",
        title: "Municipal Mechanical Notification & Safety Compliance Record",
        description:
          "Standard administrative notification filing and municipal safety log record.",
        quantity: 1,
        unitPriceCents: 6000,
        subtotalCents: 6000,
        isCustomerSupplied: false,
        warrantyCaveat: null,
      },
    ],
  });

  const [isDeclineQuoteModalOpen, setIsDeclineQuoteModalOpen] = useState(false);
  const [quoteDeclineReason, setQuoteDeclineReason] = useState<
    "PRICE_TOO_HIGH" | "SCOPE_MISMATCH" | "FOUND_ALTERNATIVE" | "DEFER_WORK" | "OTHER"
  >("PRICE_TOO_HIGH");
  const [quoteDeclineNotes, setQuoteDeclineNotes] = useState("");
  const [quoteFeedbackBanner, setQuoteFeedbackBanner] = useState<{
    tone: "success" | "warning" | "danger" | "info";
    title: string;
    message: string;
  } | null>(null);

  // State for Change Order Review (SH-12)
  const [activeChangeOrder, setActiveChangeOrder] = useState<{
    id: string;
    version: number;
    status: "SUBMITTED" | "ACCEPTED" | "DECLINED";
    reason: string;
    explanation: string;
    discoveredAt: string;
    attachmentPhotos: Array<{
      url: string;
      caption: string;
      metadata: string;
    }>;
    items: Array<{
      type: string;
      title: string;
      quantity: number;
      unitPriceCents: number;
      subtotalCents: number;
      isCustomerSupplied: boolean;
    }>;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    declineReason?: string | undefined;
  }>({
    id: "co-discovery-4091",
    version: 1,
    status: "SUBMITTED",
    reason: "Unforeseen secondary drain pan corrosion & cracked condensate union",
    explanation:
      "Upon disconnecting the air handler access panel for smart control wiring, technician identified hidden rust and active hairline seepage through the secondary drain pan into adjacent ceiling joists. Immediate replacement of the union trap is recommended to prevent ceiling water damage.",
    discoveredAt: "Today at 11:15 AM (On-Site Discovery)",
    attachmentPhotos: [
      {
        url: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80",
        caption: "Corroded secondary galvanized pan showing pinhole rust and moisture pooling.",
        metadata: "Camera: On-Site Inspection · 11:12 AM · GPS Verified (King St W)",
      },
      {
        url: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=600&q=80",
        caption: "Hairline fracture on 3/4 inch Schedule 40 PVC condensate union trap.",
        metadata: "Camera: Micro-Lens Diagnostic · 11:14 AM · Flow Test Leak Verified",
      },
    ],
    items: [
      {
        type: "LABOUR",
        title: "Condensate Line Drain Splice & Union Trap Re-piping Labour",
        quantity: 1,
        unitPriceCents: 6000,
        subtotalCents: 6000,
        isCustomerSupplied: false,
      },
      {
        type: "MATERIAL",
        title: "Schedule 40 PVC 3/4-inch Condensate Union, P-Trap & Primer",
        quantity: 1,
        unitPriceCents: 2000,
        subtotalCents: 2000,
        isCustomerSupplied: false,
      },
    ],
    subtotalCents: 8000,
    taxCents: 1040,
    totalCents: 9040,
  });

  const [isDeclineCoModalOpen, setIsDeclineCoModalOpen] = useState(false);
  const [coDeclineReason, setCoDeclineReason] = useState<
    "DEFER_WORK" | "DISAGREE_WITH_SCOPE" | "PRICE_TOO_HIGH" | "OTHER"
  >("DEFER_WORK");
  const [coDeclineNotes, setCoDeclineNotes] = useState("");
  const [selectedPhotoForPreview, setSelectedPhotoForPreview] = useState<{
    url: string;
    caption: string;
    metadata: string;
  } | null>(null);

  // --- NOTIFICATION PREFERENCES & RELIABLE OUTBOX (SH-09) ---
  const [notificationPreferences, setNotificationPreferences] = useState<
    Array<{
      category: NotificationPreferenceCategory;
      label: string;
      description: string;
      emailEnabled: boolean;
      smsEnabled: boolean;
      pushEnabled: boolean;
      isStatutory: boolean;
    }>
  >([
    {
      category: "SAFETY_EMERGENCY",
      label: "Safety & Emergency Alerts",
      description: "Gas leak warnings, carbon monoxide hazards, freeze freeze-up alerts. Mandatory by Ontario safety statutes.",
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      isStatutory: true,
    },
    {
      category: "TRANSACTIONAL_RECEIPTS",
      label: "Invoices & Payment Receipts",
      description: "Stripe transaction proofs, milestone releases, and tax receipts. Non-excludable under Ontario Consumer Protection Act.",
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: false,
      isStatutory: true,
    },
    {
      category: "DISPATCH_ALERTS",
      label: "Technician Dispatch & ETA",
      description: "Live updates when technician departs, GPS live tracking link, and arrival on site.",
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      isStatutory: false,
    },
    {
      category: "JOB_MILESTONES",
      label: "Job Progress & Sign-offs",
      description: "Diagnostic reports, quote approvals, milestone completion requests, and warranty certificates.",
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      isStatutory: false,
    },
    {
      category: "MARKETING_PROMOTIONS",
      label: "Seasonal Maintenance & Promotions",
      description: "Annual HVAC tune-up reminders, heat pump rebate notifications, and seasonal promotions.",
      emailEnabled: false,
      smsEnabled: false,
      pushEnabled: false,
      isStatutory: false,
    },
  ]);

  const [customerOutbox, setCustomerOutbox] = useState<
    Array<{
      id: string;
      channel: NotificationChannel;
      recipient: string;
      subject: string;
      preview: string;
      category: NotificationPreferenceCategory;
      status: OutboxStatus;
      sentAt: string;
      idempotencyKey: string;
    }>
  >([
    {
      id: "outbox-notif-01",
      channel: "EMAIL",
      recipient: "sarah.jenkins@example.com",
      subject: "Skilled Hire: Payment Receipt - Diagnostic Call-Out Fee",
      preview: "Payment of $89.00 CAD received. Diagnostic dispatch confirmed for Marcus Miller (HVAC 313A).",
      category: "TRANSACTIONAL_RECEIPTS",
      status: "DELIVERED",
      sentAt: "Today, 10:45 AM",
      idempotencyKey: "evt:pay:receipt:88194",
    },
    {
      id: "outbox-notif-02",
      channel: "SMS",
      recipient: "+14165550198",
      subject: "Technician En-Route",
      preview: "Marcus is en-route in truck #HV-04! ETA 14 mins. Live track: https://skilledhire.ca/t/88194",
      category: "DISPATCH_ALERTS",
      status: "DELIVERED",
      sentAt: "Today, 10:52 AM",
      idempotencyKey: "evt:dispatch:enroute:88194",
    },
  ]);

  const [notifFeedback, setNotifFeedback] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSendingTestNotif, setIsSendingTestNotif] = useState(false);

  // --- STRIPE PAYMENTS & MILESTONES STATE (SH-07) ---
  const [milestones, setMilestones] = useState<Array<{
    id: string;
    title: string;
    trigger: string;
    amountCents: number;
    platformFeeCents: number;
    status: "PENDING" | "PAID";
    paidAt?: string | undefined;
    transactionRef?: string | undefined;
  }>>([
    {
      id: "ms-callout-01",
      title: "Diagnostic Call-Out Fee & Truck Dispatch",
      trigger: "Technician Arrived On-Site",
      amountCents: 8900,
      platformFeeCents: 445,
      status: "PAID",
      paidAt: "Today, 10:45 AM",
      transactionRef: "pi_test_diag_88194",
    },
    {
      id: "ms-completion-02",
      title: "Work Completion Balance (Labor & OEM Run Capacitor)",
      trigger: "Customer Completion Sign-Off",
      amountCents: 18500,
      platformFeeCents: 925,
      status: "PENDING",
    },
  ]);
  const [selectedMilestoneForPay, setSelectedMilestoneForPay] = useState<{
    id: string;
    title: string;
    trigger: string;
    amountCents: number;
    platformFeeCents: number;
    status: "PENDING" | "PAID";
    paidAt?: string | undefined;
    transactionRef?: string | undefined;
  } | null>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [testOutcome, setTestOutcome] = useState<"success" | "card_declined" | "requires_action">("success");
  const [checkoutProcessing, setCheckoutProcessing] = useState(false);
  const [checkoutFeedback, setCheckoutFeedback] = useState<string | null>(null);
  const [customerPms, setCustomerPms] = useState<Array<{
    id: string;
    brand: string;
    last4: string;
    exp: string;
    isDefault: boolean;
  }>>([
    {
      id: "pm_test_visa4242",
      brand: "Visa",
      last4: "4242",
      exp: "12/28",
      isDefault: true,
    },
  ]);

  // --- SERVICE DIRECTORY & SEARCH ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFamily, setSelectedFamily] = useState<string>("ALL");
  const [selectedDomain, setSelectedDomain] = useState<string>("hvac");
  const [bookingStep, setBookingStep] = useState(0);

  // --- BOOKING FORM & ESTIMATE ---
  const [postalCode, setPostalCode] = useState<string>("M5V 2T6");
  const [slotAvailability, setSlotAvailability] = useState<SlotAvailabilityResponse | null>(null);
  const [activeHold, setActiveHold] = useState<{
    holdId: string;
    holdToken: string;
    technicianName?: string | undefined;
    holdExpiresAt: string;
  } | null>(null);
  const [holdRemainingSeconds, setHoldRemainingSeconds] = useState<number>(900);
  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [reserveMessage, setReserveMessage] = useState<string | null>(null);
  const [assignedTechName, setAssignedTechName] = useState<string>("Marcus Sterling");

  // --- CUSTOMER PROFILE & PROPERTIES STATE (SH-11, Issue #12) ---
  const [customerProfile, setCustomerProfile] = useState<CustomerProfileDTO>({
    id: "user-cust-avery",
    email: "sarah.jenkins@example.com",
    fullName: "Sarah Jenkins",
    phoneNumber: "+1 (416) 555-0198",
    role: "CUSTOMER",
    emailVerified: true,
    mfaEnabled: true,
    propertiesCount: 2,
    activeServiceRequestsCount: 1,
    completedJobsCount: 4,
    courtesyCreditBalanceCents: 3000,
    createdAt: "2025-04-10T14:22:00.000Z",
  });

  const [properties, setProperties] = useState<CustomerPropertyDTO[]>([
    {
      id: "prop-king-123",
      customerId: "user-cust-avery",
      label: "Primary Residence",
      addressLine1: "123 King Street W",
      unitNumber: "Unit 1402",
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 2T6",
      propertyType: "CONDO",
      accessNotes: "Buzz code #1402 at main entrance. Concierge will verify contractor ID.",
      isPrimary: true,
      equipmentCount: 2,
      createdAt: "2025-04-10T14:25:00.000Z",
      updatedAt: "2026-02-14T09:15:00.000Z",
    },
    {
      id: "prop-cottage-456",
      customerId: "user-cust-avery",
      label: "Muskoka Lake Cottage",
      addressLine1: "45 Peninsula Point Rd",
      city: "Gravenhurst",
      region: "ON",
      postalCode: "P1P 1R1",
      propertyType: "DETACHED",
      accessNotes: "Keypad code on side utility room: 4921. Gate latch requires lifting handle.",
      isPrimary: false,
      equipmentCount: 1,
      createdAt: "2025-08-20T11:00:00.000Z",
      updatedAt: "2025-08-20T11:00:00.000Z",
    },
  ]);

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("prop-king-123");

  const [propertyEquipmentMap, setPropertyEquipmentMap] = useState<
    Record<string, EquipmentItem[]>
  >({
    "prop-king-123": [
      {
        id: "eq-lennox-ac",
        verticalId: "vert-hvac",
        name: "Lennox Signature High-Efficiency Central AC",
        assetType: "AIR_CONDITIONER",
        manufacturer: "Lennox",
        modelNumber: "XC21-036-230",
        serialNumber: "5821-LEN-2021",
        warrantyStatus: "ACTIVE",
        installedOn: "2021-06-15",
      },
      {
        id: "eq-carrier-furnace",
        verticalId: "vert-hvac",
        name: "Carrier Infinity 98 Modulating Gas Furnace",
        assetType: "FURNACE",
        manufacturer: "Carrier",
        modelNumber: "59MN7A060V17",
        serialNumber: "CAR-98-8472",
        warrantyStatus: "ACTIVE",
        installedOn: "2020-10-12",
      },
    ],
    "prop-cottage-456": [
      {
        id: "eq-mitsubishi-heatpump",
        verticalId: "vert-hvac",
        name: "Mitsubishi Electric Zuba-Central Cold-Climate Heat Pump",
        assetType: "HEAT_PUMP",
        manufacturer: "Mitsubishi Electric",
        modelNumber: "PUZ-HA36NHA5",
        serialNumber: "ME-ZUBA-99120",
        warrantyStatus: "EXTENDED",
        installedOn: "2023-05-20",
      },
    ],
  });

  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("eq-lennox-ac");

  // Dynamic intake symptom checklists & system age
  const [symptomSelections, setSymptomSelections] = useState<string[]>([
    "Compressor Humming / Fan Stalled",
    "Indoor Air Warm / Not Cooling",
  ]);
  const [filterLastChanged, setFilterLastChanged] = useState<string>("1-3 months ago");
  const [equipmentAgeYears, setEquipmentAgeYears] = useState<string>("4-7 years");

  // Booking Draft Persistence & Receipts
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>("Just now");
  const [confirmedReceipt, setConfirmedReceipt] = useState<BookingReceiptDTO | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

  // Modals
  const [isAddPropertyModalOpen, setIsAddPropertyModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAddEquipmentModalOpen, setIsAddEquipmentModalOpen] = useState(false);

  // Modal forms
  const [newPropLabel, setNewPropLabel] = useState("");
  const [newPropAddress, setNewPropAddress] = useState("");
  const [newPropUnit, setNewPropUnit] = useState("");
  const [newPropCity, setNewPropCity] = useState("Toronto");
  const [newPropPostalCode, setNewPropPostalCode] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("DETACHED");
  const [newPropAccessNotes, setNewPropAccessNotes] = useState("");
  const [newPropIsPrimary, setNewPropIsPrimary] = useState(false);

  const [editProfileName, setEditProfileName] = useState(customerProfile.fullName);
  const [editProfilePhone, setEditProfilePhone] = useState(customerProfile.phoneNumber ?? "");

  const [newEqName, setNewEqName] = useState("");
  const [newEqAssetType, setNewEqAssetType] = useState("AIR_CONDITIONER");
  const [newEqManufacturer, setNewEqManufacturer] = useState("");
  const [newEqModelNumber, setNewEqModelNumber] = useState("");
  const [newEqSerialNumber, setNewEqSerialNumber] = useState("");
  const [newEqWarranty, setNewEqWarranty] = useState<"ACTIVE" | "EXPIRED" | "UNKNOWN" | "EXTENDED">("ACTIVE");

  const [selectedSlot, setSelectedSlot] = useState<string>("today-13-15");
  const [description, setDescription] = useState(
    "Central AC compressor humming loudly, but condenser fan not turning and indoor air is warm.",
  );
  const [urgency, setUrgency] = useState<"STANDARD" | "EMERGENCY">("STANDARD");
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);

  const handleSelectProperty = (propId: string) => {
    setSelectedPropertyId(propId);
    const prop = properties.find((p) => p.id === propId);
    if (prop) {
      setPostalCode(prop.postalCode);
      const eqList = propertyEquipmentMap[propId] ?? [];
      setSelectedEquipmentId(eqList[0]?.id ?? "");
    }
  };

  // Cross-device & mobile draft persistence
  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("skilled_hire_booking_draft_v1") : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.domain) setSelectedDomain(parsed.domain);
        if (parsed.propertyId && properties.some((p) => p.id === parsed.propertyId)) {
          setSelectedPropertyId(parsed.propertyId);
        }
        if (parsed.equipmentId) setSelectedEquipmentId(parsed.equipmentId);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.urgency) setUrgency(parsed.urgency);
        if (parsed.selectedSlot) setSelectedSlot(parsed.selectedSlot);
        if (parsed.symptoms && Array.isArray(parsed.symptoms)) {
          setSymptomSelections(parsed.symptoms);
        }
        setDraftSavedAt("Restored from draft");
      }
    } catch {
      // LocalStorage unavailable
    }
  }, []);

  // Auto-save draft on form change
  useEffect(() => {
    if (bookingConfirmed) return;
    const timeout = setTimeout(() => {
      try {
        if (typeof window !== "undefined") {
          const payload = {
            domain: selectedDomain,
            propertyId: selectedPropertyId,
            equipmentId: selectedEquipmentId,
            description,
            urgency,
            selectedSlot,
            symptoms: symptomSelections,
            step: bookingStep,
          };
          localStorage.setItem("skilled_hire_booking_draft_v1", JSON.stringify(payload));
          const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setDraftSavedAt(now);
        }
      } catch {
        // storage quota
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [
    selectedDomain,
    selectedPropertyId,
    selectedEquipmentId,
    description,
    urgency,
    selectedSlot,
    symptomSelections,
    bookingStep,
    bookingConfirmed,
  ]);

  // --- TECHNICIAN SERVICE RECOMMENDATIONS & RESPONSE TRACKING ---
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
        "During diagnostic voltage and capacitance metering of outdoor Lennox condenser unit, capacitor measured 28.5µF (rated 45µF ±5%), showing 36% degradation. Running the compressor under-capacitated will cause thermal overload trip and potential permanent compressor burn-out during high summer loads.",
      urgency: "URGENT_REPAIR",
      status: "PROPOSED",
      estimatedCostCents: 18500,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80",
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      technicianName: "Marcus Sterling (Lead HVAC Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "123 King Street W, Unit 1402, Toronto",
      responses: [
        {
          id: "resp-01",
          recommendationId: "rec-2026-4412-01",
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: "Discovered during multimeter check of outdoor electrical compartment.",
          metadata: { estimatedCostCents: 18500, urgency: "URGENT_REPAIR" },
          createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
      ],
    },
    {
      id: "rec-2026-3910-02",
      jobId: "JOB-2026-3910",
      serviceRequestId: "REQ-2026-8814",
      propertyId: "prop-king-123",
      customerId: "user-cust-avery",
      contractorId: "cont-mapleshield",
      technicianId: "tech-elena",
      title: "Whole-Home Type 2 Surge Protection on 200A Electrical Panel",
      description:
        "Main Siemens electrical distribution panel lacks transient voltage surge suppression. High-value heat pump inverter boards and smart thermostats are exposed to grid voltage spikes. Recommended Eaton CHSP Ultra Type 2 surge protector installation.",
      urgency: "UPGRADE_OPPORTUNITY",
      status: "ACCEPTED",
      estimatedCostCents: 24000,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=400&q=80",
      ],
      homeownerResponseNotes: "Authorized installation during panel service visit to safeguard smart home electronics.",
      respondedAt: "2026-09-14T14:35:00.000Z",
      createdAt: "2026-09-14T13:40:00.000Z",
      updatedAt: "2026-09-14T14:35:00.000Z",
      technicianName: "Elena Rostova (Master Electrician)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "123 King Street W, Unit 1402, Toronto",
      responses: [
        {
          id: "resp-3910-01",
          recommendationId: "rec-2026-3910-02",
          action: "PROPOSED",
          actorId: "tech-elena",
          actorRole: "TECHNICIAN",
          notes: "Inspected panel bus bar and noted absent surge suppression.",
          metadata: { estimatedCostCents: 24000, urgency: "UPGRADE_OPPORTUNITY" },
          createdAt: "2026-09-14T13:40:00.000Z",
        },
        {
          id: "resp-3910-02",
          recommendationId: "rec-2026-3910-02",
          action: "ACCEPTED",
          actorId: "user-cust-avery",
          actorRole: "CUSTOMER",
          notes: "Authorized installation during panel service visit to safeguard smart home electronics.",
          metadata: { decision: "ACCEPTED", convertImmediately: true },
          createdAt: "2026-09-14T14:35:00.000Z",
        },
      ],
    },
    {
      id: "rec-2026-3820-03",
      jobId: "JOB-2026-3820",
      serviceRequestId: "REQ-2026-7640",
      propertyId: "prop-king-123",
      customerId: "user-cust-avery",
      contractorId: "cont-mapleshield",
      technicianId: "tech-marcus",
      title: "HVAC Condensate Drain Line Anti-Microbial Cleanout & Trap Float Switch",
      description:
        "Condensate trap is coated in bacterial sludge and biofilm, causing slow drainage into floor drain. Recommended automated shutoff float switch and nitrogen purge to prevent future water overflow damage.",
      urgency: "RECOMMENDED_MAINTENANCE",
      status: "DEFERRED",
      estimatedCostCents: 14500,
      currency: "CAD",
      evidencePhotos: [
        "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=400&q=80",
      ],
      homeownerResponseNotes: "Requested reminder in 60 days before seasonal cooling startup.",
      respondedAt: "2026-08-22T11:20:00.000Z",
      createdAt: "2026-08-22T10:15:00.000Z",
      updatedAt: "2026-08-22T11:20:00.000Z",
      technicianName: "Marcus Sterling (Lead HVAC Journeyperson)",
      contractorName: "MapleShield Mechanical Solutions Inc.",
      propertyAddress: "123 King Street W, Unit 1402, Toronto",
      responses: [
        {
          id: "resp-3820-01",
          recommendationId: "rec-2026-3820-03",
          action: "PROPOSED",
          actorId: "tech-marcus",
          actorRole: "TECHNICIAN",
          notes: "Condensate trap inspected during seasonal check.",
          metadata: { estimatedCostCents: 14500, urgency: "RECOMMENDED_MAINTENANCE" },
          createdAt: "2026-08-22T10:15:00.000Z",
        },
        {
          id: "resp-3820-02",
          recommendationId: "rec-2026-3820-03",
          action: "DEFERRED",
          actorId: "user-cust-avery",
          actorRole: "CUSTOMER",
          notes: "Homeowner deferred for review ahead of next cooling season.",
          metadata: { decision: "DEFERRED", reminderDays: 60 },
          createdAt: "2026-08-22T11:20:00.000Z",
        },
      ],
    },
  ]);

  const [selectedRecForAction, setSelectedRecForAction] = useState<ServiceRecommendationDTO | null>(null);
  const [selectedRecForDetail, setSelectedRecForDetail] = useState<ServiceRecommendationDTO | null>(null);
  const [isAcceptModalOpen, setIsAcceptModalOpen] = useState(false);
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState<RecommendationDeclineReason>("TOO_EXPENSIVE");
  const [declineNotes, setDeclineNotes] = useState("");
  const [convertImmediately, setConvertImmediately] = useState(true);
  const [recFeedbackNotice, setRecFeedbackNotice] = useState<string | null>(null);

  const handleOpenAcceptModal = (rec: ServiceRecommendationDTO) => {
    setSelectedRecForAction(rec);
    setIsAcceptModalOpen(true);
  };

  const handleOpenDeclineModal = (rec: ServiceRecommendationDTO) => {
    setSelectedRecForAction(rec);
    setIsDeclineModalOpen(true);
  };

  const handleConfirmAccept = () => {
    if (!selectedRecForAction) return;
    const recId = selectedRecForAction.id;
    const now = new Date().toISOString();

    setRecommendations((prev) =>
      prev.map((r) =>
        r.id === recId
          ? {
              ...r,
              status: "ACCEPTED",
              respondedAt: now,
              homeownerResponseNotes: convertImmediately
                ? "Accepted and authorized for installation during today's visit."
                : "Accepted for follow-up scheduling.",
              responses: [
                ...(r.responses ?? []),
                {
                  id: `resp-accept-${Date.now()}`,
                  recommendationId: recId,
                  action: "ACCEPTED",
                  actorId: "user-cust-avery",
                  actorRole: "CUSTOMER",
                  notes: convertImmediately
                    ? "Accepted and authorized for installation during today's visit."
                    : "Accepted for follow-up scheduling.",
                  metadata: { decision: "ACCEPTED", convertImmediately },
                  createdAt: now,
                },
              ],
            }
          : r,
      ),
    );

    setIsAcceptModalOpen(false);
    setSelectedRecForAction(null);
    setRecFeedbackNotice(
      `✓ You accepted "${selectedRecForAction.title}"! ${selectedRecForAction.technicianName ?? "Your technician"} has been notified ($${(selectedRecForAction.estimatedCostCents / 100).toFixed(2)} CAD).`,
    );
    setTimeout(() => setRecFeedbackNotice(null), 8000);
  };

  const handleConfirmDecline = () => {
    if (!selectedRecForAction) return;
    const recId = selectedRecForAction.id;
    const now = new Date().toISOString();

    setRecommendations((prev) =>
      prev.map((r) =>
        r.id === recId
          ? {
              ...r,
              status: "DECLINED",
              declineReason,
              homeownerResponseNotes: declineNotes || "No additional comments provided.",
              respondedAt: now,
              responses: [
                ...(r.responses ?? []),
                {
                  id: `resp-decline-${Date.now()}`,
                  recommendationId: recId,
                  action: "DECLINED",
                  actorId: "user-cust-avery",
                  actorRole: "CUSTOMER",
                  notes: declineNotes || "No additional comments provided.",
                  metadata: { decision: "DECLINED", declineReason },
                  createdAt: now,
                },
              ],
            }
          : r,
      ),
    );

    setIsDeclineModalOpen(false);
    setSelectedRecForAction(null);
    setDeclineNotes("");
    setRecFeedbackNotice(
      "Recommendation declined. Your response and reason have been preserved in your permanent Property Service Passport.",
    );
    setTimeout(() => setRecFeedbackNotice(null), 8000);
  };

  const handleDeferRecommendation = (recId: string) => {
    const now = new Date().toISOString();
    setRecommendations((prev) =>
      prev.map((r) =>
        r.id === recId
          ? {
              ...r,
              status: "DEFERRED",
              respondedAt: now,
              responses: [
                ...(r.responses ?? []),
                {
                  id: `resp-defer-${Date.now()}`,
                  recommendationId: recId,
                  action: "DEFERRED",
                  actorId: "user-cust-avery",
                  actorRole: "CUSTOMER",
                  notes: "Homeowner requested reminder in 60 days before seasonal change.",
                  metadata: { decision: "DEFERRED", reminderDays: 60 },
                  createdAt: now,
                },
              ],
            }
          : r,
      ),
    );
    setRecFeedbackNotice(
      "⏱ Recommendation deferred. We will send you an automated reminder in 60 days before the seasonal temperature change.",
    );
    setTimeout(() => setRecFeedbackNotice(null), 8000);
  };

  // --- DISPATCH EXCEPTIONS, CANCELLATION & NO-SHOW RECOVERY (SH-10) ---
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] =
    useState<CancellationReason>("CUSTOMER_SCHEDULE_CONFLICT");
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancellationResult, setCancellationResult] = useState<{
    cancelledAt: string;
    feeCents: number;
    refundCents: number;
    policyType: CancellationPolicyType;
    explanation: string;
  } | null>(null);

  const [isNoShowModalOpen, setIsNoShowModalOpen] = useState(false);
  const [noShowNotes, setNoShowNotes] = useState("");
  const [isReportingNoShow, setIsReportingNoShow] = useState(false);

  const [activeDispatchException, setActiveDispatchException] = useState<{
    id: string;
    type: DispatchExceptionType;
    severity: DispatchExceptionSeverity;
    status: DispatchExceptionStatus;
    reason: string;
    standbyContractorName?: string;
    standbyTechnicianName?: string;
    standbyEtaMinutes?: number;
    courtesyCreditAwardedCents: number;
    slaRemainingSeconds: number;
  } | null>(null);

  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [recoveryChoiceFeedback, setRecoveryChoiceFeedback] =
    useState<string | null>(null);

  const [serviceCredits, setServiceCredits] = useState<
    CustomerServiceCreditDTO[]
  >([
    {
      id: "cred-ontario-welcome-01",
      customerId: "user-cust-avery",
      amountCents: 1500,
      balanceCents: 1500,
      reason: "Skilled Hire Welcome Homeowner Credit",
      status: "ACTIVE",
      expiresAt: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      createdAt: new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      updatedAt: new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  ]);

  const totalActiveCreditsCents = useMemo(() => {
    return serviceCredits
      .filter((c) => c.status === "ACTIVE")
      .reduce((sum, c) => sum + c.amountCents, 0);
  }, [serviceCredits]);

  // Live countdown for SLA timer (15m window)
  useEffect(() => {
    if (
      !activeDispatchException ||
      activeDispatchException.slaRemainingSeconds <= 0
    )
      return;
    const interval = setInterval(() => {
      setActiveDispatchException((prev) => {
        if (!prev) return null;
        const remaining = Math.max(0, prev.slaRemainingSeconds - 1);
        return {
          ...prev,
          slaRemainingSeconds: remaining,
          status:
            remaining === 0 && prev.status === "OPEN"
              ? "ESCALATED"
              : prev.status,
        };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeDispatchException]);

  const cancelQuote = useMemo(() => {
    const scheduledStartsAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    return evaluateCancellationPolicy({
      cancelledByRole: "CUSTOMER",
      scheduledStartsAt,
      amountPaidCents: 8900,
      reason: cancelReason,
      forceMajeure: cancelReason === "SEVERE_WEATHER_HAZARD",
      now: new Date(),
    });
  }, [cancelReason]);

  const handleConfirmCancellation = () => {
    setCancellationResult({
      cancelledAt: new Date().toLocaleTimeString("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      feeCents: cancelQuote.cancellationFeeCents,
      refundCents: cancelQuote.refundAmountCents,
      policyType: cancelQuote.policyApplied,
      explanation: cancelQuote.explanation,
    });
    setIsCancelModalOpen(false);
  };

  const handleConfirmReportNoShow = () => {
    setIsReportingNoShow(true);
    setTimeout(() => {
      setIsReportingNoShow(false);
      setIsNoShowModalOpen(false);

      const excId = `EXC-${Date.now().toString().slice(-4)}`;
      setActiveDispatchException({
        id: excId,
        type: "TECHNICIAN_NO_SHOW",
        severity: "HIGH",
        status: "OPEN",
        reason:
          noShowNotes ||
          "Technician failed to arrive within scheduled 30m window without notice.",
        standbyContractorName: "Apex Climate Mechanical Pro",
        standbyTechnicianName: "Liam Vance (TSSA Gas G1 #771890)",
        standbyEtaMinutes: 20,
        courtesyCreditAwardedCents: 2500,
        slaRemainingSeconds: 900,
      });

      const newCredit: CustomerServiceCreditDTO = {
        id: `cred-noshow-${Date.now().toString().slice(-4)}`,
        customerId: "user-cust-avery",
        amountCents: 2500,
        balanceCents: 2500,
        reason:
          "Ontario On-Time Guarantee Courtesy Credit (Booking #REQ-2026-9921)",
        status: "ACTIVE",
        expiresAt: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setServiceCredits((prev) => [newCredit, ...prev]);
      setIsRecoveryModalOpen(true);
    }, 400);
  };

  const handleRecoveryChoice = (choice: CustomerRecoveryChoiceType) => {
    if (!activeDispatchException) return;

    if (choice === "ACCEPT_REASSIGNMENT") {
      setActiveDispatchException((prev) =>
        prev ? { ...prev, status: "RESOLVED" } : null,
      );
      setAssignedTechName("Liam Vance (TSSA G1 #771890)");
      setEtaMinutes(20);
      setRecoveryChoiceFeedback(
        "✓ Standby specialist Liam Vance accepted! Arriving in 20 minutes. $25 courtesy credit remains active in your wallet.",
      );
    } else if (choice === "RESCHEDULE_NEW_SLOT") {
      setActiveDispatchException((prev) =>
        prev ? { ...prev, status: "RESOLVED" } : null,
      );
      setRecoveryChoiceFeedback(
        "✓ Appointment rescheduled to Tomorrow at 9:00 AM with VIP priority dispatch lock. $25 courtesy credit applied.",
      );
    } else if (choice === "FULL_REFUND_CANCEL") {
      setActiveDispatchException((prev) =>
        prev ? { ...prev, status: "RESOLVED" } : null,
      );
      setCancellationResult({
        cancelledAt: new Date().toLocaleTimeString("en-CA", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        feeCents: 0,
        refundCents: 8900,
        policyType: "CONTRACTOR_FAULT_FULL_REFUND_WITH_CREDIT",
        explanation:
          "100% full refund issued due to contractor no-show. $25 courtesy credit retained.",
      });
      setRecoveryChoiceFeedback(
        "✓ Appointment cancelled. Full 100% refund of $89.00 CAD initiated to your Stripe account. Your $25 courtesy credit remains in your wallet.",
      );
    }

    setIsRecoveryModalOpen(false);
    setTimeout(() => setRecoveryChoiceFeedback(null), 10000);
  };

  // Live countdown timer for active exclusive slot hold lease (15 mins)
  useEffect(() => {
    if (!activeHold) return;
    const interval = setInterval(() => {
      const expiresAt = new Date(activeHold.holdExpiresAt).getTime();
      const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setHoldRemainingSeconds(diff);
      if (diff <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeHold]);

  // Fetch evidence-backed slot availability from API
  useEffect(() => {
    let cancelled = false;
    const loadAvailability = async () => {
      try {
        const res = await fetch(
          `/api/v1/dispatch/slot-availability?vertical=${selectedDomain}&postalCode=${encodeURIComponent(postalCode)}`,
        );
        if (res.ok && !cancelled) {
          const data = (await res.json()) as SlotAvailabilityResponse;
          setSlotAvailability(data);
          return;
        }
      } catch {
        // Fallback local evidence state
      }
      if (!cancelled) {
        setSlotAvailability({
          verticalSlug: selectedDomain,
          verticalName: selectedDomain.toUpperCase(),
          region: "ON",
          postalFsa: postalCode.slice(0, 3).toUpperCase(),
          queriedSlot: selectedSlot,
          available: true,
          status: "AVAILABLE",
          headline: `Verified licensed specialists ready for dispatch in ${postalCode.slice(0, 3).toUpperCase()}`,
          reason: "Evidence confirmed: 3 certified trade professionals have open conflict-free capacity.",
          availableCapacity: 3,
          availabilityConfidence: "HIGH",
          metrics: {
            activeCertifiedTechnicians: 3,
            dispatchedCount: 1,
            capacitySaturationBps: 3333,
            estimatedWaitMinutes: 0,
            eligibleTechniciansInFsa: 3,
            openSlotCount: 2,
          },
          alternativeSlots: [
            {
              id: "today-13-15",
              label: "Today · 1:00–3:00 PM (Afternoon Window)",
              day: "Today",
              time: "1:00 PM – 3:00 PM",
              guaranteed: false,
              demandLevel: "NORMAL",
              badge: "2 Technicians Open",
              availableCapacity: 2,
              confidence: "HIGH",
            },
            {
              id: "today-16-18",
              label: "Today · 4:00–6:00 PM (Late Window)",
              day: "Today",
              time: "4:00 PM – 6:00 PM",
              guaranteed: false,
              demandLevel: "NORMAL",
              badge: "1 Technician Open",
              availableCapacity: 1,
              confidence: "LIMITED",
            },
            {
              id: "tomorrow-09-11",
              label: "Tomorrow · 9:00–11:00 AM (Recommended Morning)",
              day: "Tomorrow",
              time: "9:00 AM – 11:00 AM",
              guaranteed: false,
              demandLevel: "LOW",
              badge: "3 Technicians Open",
              availableCapacity: 3,
              confidence: "HIGH",
            },
            {
              id: "tomorrow-14-16",
              label: "Tomorrow · 2:00–4:00 PM (Afternoon Window)",
              day: "Tomorrow",
              time: "2:00 PM – 4:00 PM",
              guaranteed: false,
              demandLevel: "NORMAL",
              badge: "2 Technicians Open",
              availableCapacity: 2,
              confidence: "HIGH",
            },
          ],
          emergencyOption: {
            available: true,
            evidenceSupported: true,
            title: "Request Emergency Priority Dispatch",
            badge: "⚡ Verified On-Call (1 unit available)",
            description: `Routes directly to verified on-call specialists currently active in ${postalCode.slice(0, 3).toUpperCase()}.`,
            calloutFeeCents: 14900,
            slaMinutes: 45,
            availableTechniciansCount: 1,
          },
        });
      }
    };
    loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [selectedDomain, postalCode, selectedSlot]);

  // Acquire 15-minute atomic exclusive hold when a slot is clicked
  const handleSelectSlot = async (slotId: string) => {
    setSelectedSlot(slotId);
    setIsReserving(true);
    setReserveMessage(null);
    try {
      const now = new Date();
      const startsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
      const endsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
      const res = await fetch("/api/v1/dispatch/slots/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verticalSlug: selectedDomain,
          postalCode,
          slotStartsAt: startsAt,
          slotEndsAt: endsAt,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          holdId: string;
          holdToken: string;
          technicianName?: string;
          holdExpiresAt: string;
          expiresInSeconds?: number;
        };
        setActiveHold({
          holdId: data.holdId,
          holdToken: data.holdToken,
          technicianName: data.technicianName,
          holdExpiresAt: data.holdExpiresAt,
        });
        setHoldRemainingSeconds(data.expiresInSeconds ?? 900);
        if (data.technicianName) {
          setAssignedTechName(data.technicianName);
        }
        setReserveMessage("✓ 15-Minute Exclusive Hold Acquired. Double-booking prevented.");
        setIsReserving(false);
        return;
      }
    } catch {
      // Local fallback simulation
    }
    const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setActiveHold({
      holdId: "simulated-hold-1",
      holdToken: "hold_token_simulated",
      technicianName: "Marcus Sterling",
      holdExpiresAt,
    });
    setHoldRemainingSeconds(900);
    setReserveMessage("✓ 15-Minute Exclusive Hold Acquired. Double-booking prevented across Ontario dispatch.");
    setIsReserving(false);
  };

  const handleConfirmMilestonePayment = async () => {
    if (!selectedMilestoneForPay) return;
    setCheckoutProcessing(true);
    setCheckoutFeedback(null);

    try {
      await new Promise((r) => setTimeout(r, 600));

      if (testOutcome === "card_declined") {
        setCheckoutFeedback("❌ Payment Failed: Your card was declined by the issuer (card_declined test simulation). Please try another payment method.");
        setCheckoutProcessing(false);
        return;
      }

      if (testOutcome === "requires_action") {
        setCheckoutFeedback("🔐 3D Secure / SCA Challenge passed. Interac/Visa verified.");
      }

      const txRef = `pi_test_${crypto.randomUUID().slice(0, 16)}`;
      setMilestones((prev) =>
        prev.map((m) =>
          m.id === selectedMilestoneForPay.id
            ? {
                ...m,
                status: "PAID",
                paidAt: "Just now",
                transactionRef: txRef,
              }
            : m,
        ),
      );

      setCheckoutFeedback(`✓ Payment Succeeded: $${(selectedMilestoneForPay.amountCents / 100).toFixed(2)} CAD processed via Stripe Connect. Receipt: ${txRef}`);
      setIsCheckoutModalOpen(false);
      setSelectedMilestoneForPay(null);
    } catch {
      setCheckoutFeedback("Payment processing error. Please retry.");
    } finally {
      setCheckoutProcessing(false);
    }
  };

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

  // --- PRODUCTION IDENTITY & MFA SECURITY STATE (SH-03) ---
  const [mfaActive, setMfaActive] = useState(false);
  const [mfaSetupOpen, setMfaSetupOpen] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("JBSWY3DPEHPK3PXP");
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[]>([
    "A1B2-C3D4",
    "E5F6-G7H8",
    "J9K0-L1M2",
    "N3P4-Q5R6",
    "S7T8-U9V0",
    "W1X2-Y3Z4",
    "B5C6-D7E8",
    "F9G0-H1J2",
  ]);
  const [mfaInputCode, setMfaInputCode] = useState("");
  const [mfaFeedback, setMfaFeedback] = useState<string | null>(null);
  const [activeSessions, setActiveSessions] = useState([
    {
      id: "sess-curr-1",
      device: "MacBook Pro · Chrome 128 (macOS Sequoia)",
      ip: "142.250.80.46 · Toronto, ON",
      lastActive: "Active Now",
      isCurrent: true,
    },
    {
      id: "sess-mobile-2",
      device: "iPhone 16 Pro · Safari Mobile 18",
      ip: "142.250.80.46 · Toronto, ON",
      lastActive: "2 hours ago",
      isCurrent: false,
    },
  ]);
  const [revokeAllFeedback, setRevokeAllFeedback] = useState<string | null>(null);

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

  const handleConfirmBooking = async () => {
    if (activeHold?.holdToken) {
      try {
        await fetch("/api/v1/dispatch/slots/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdToken: activeHold.holdToken,
          }),
        });
      } catch {
        // Fallback
      }
    }

    const currentProp =
      properties.find((p) => p.id === selectedPropertyId) ?? properties[0]!;
    const eqList = propertyEquipmentMap[selectedPropertyId] ?? [];
    const currentEq = eqList.find((e) => e.id === selectedEquipmentId);
    const selectedSlotObj = (slotAvailability?.alternativeSlots ?? []).find(
      (s) => s.id === selectedSlot,
    );

    const receipt: BookingReceiptDTO = {
      serviceRequestId: `REQ-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      referenceNumber: `SH-ONT-${Date.now().toString().slice(-6)}`,
      status: "CONFIRMED",
      customerId: customerProfile.id,
      customerName: customerProfile.fullName,
      customerPhone: customerProfile.phoneNumber ?? undefined,
      propertyId: currentProp.id,
      propertyLabel: currentProp.label,
      propertyAddress: `${currentProp.addressLine1}${currentProp.unitNumber ? ` (${currentProp.unitNumber})` : ""}, ${currentProp.city}, ${currentProp.region} ${currentProp.postalCode}`,
      verticalSlug: selectedDomain,
      tradeName: activeDomainObj.label,
      categoryName: activeDomainObj.category,
      issueName: activeDomainObj.defaultIssue,
      urgency,
      description,
      equipmentSummary: currentEq
        ? `${currentEq.manufacturer ?? ""} ${currentEq.name} (Model: ${currentEq.modelNumber ?? "N/A"}, S/N: ${currentEq.serialNumber ?? "N/A"})`
        : "General Diagnostic Assessment (No equipment pre-bound)",
      scheduledStart: selectedSlotObj
        ? `${selectedSlotObj.day} at ${selectedSlotObj.time.split(" - ")[0]}`
        : "Today at 1:00 PM",
      scheduledEnd: selectedSlotObj
        ? `${selectedSlotObj.day} at ${selectedSlotObj.time.split(" - ")[1]}`
        : "Today at 3:00 PM",
      basePriceCents: diagnosticFeeCents,
      protectionCoverageCents: includeInsurance ? 2500000 : 0,
      guaranteeSummary:
        "Backed by 365-Day Skilled Hire Workmanship Guarantee ($25,000 protection cap)",
      cancellationPolicySummary:
        "Ontario CPA Compliant: Full refund if cancelled 2+ hours prior to arrival window",
      statutoryDisclosures: [
        "Technical Standards and Safety Act (TSSA) Ontario Regulation 211/01 (Fuel Safety)",
        "Ontario Electrical Safety Code (OESC) / Electrical Safety Authority (ESA) Authorized Work",
        "Ontario Consumer Protection Act (CPA) 2002 Consumer Rights & 10-Day Statutory Disclosures",
      ],
      submittedAt: new Date().toISOString(),
    };

    setConfirmedReceipt(receipt);
    setIsReceiptModalOpen(true);
    setBookingConfirmed(true);
    setBookingStep(3);

    // Clear saved draft on completion
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("skilled_hire_booking_draft_v1");
      }
      setDraftSavedAt(null);
    } catch {
      // ignore
    }
  };

  const handleSurveySubmit = () => {
    setSurveySubmitted(true);
    setCreditBalanceCents(3000);
  };

  const handleTogglePreference = (
    category: NotificationPreferenceCategory,
    channel: "email" | "sms" | "push"
  ) => {
    const target = notificationPreferences.find((p) => p.category === category);
    if (!target) return;

    if (target.isStatutory) {
      setNotifFeedback({
        message: `Ontario Consumer Protection & Safety Regulation prevents disabling ${target.label}. Statutory consumer notices are legally required to remain active.`,
        type: "error",
      });
      return;
    }

    setNotificationPreferences((prev) =>
      prev.map((item) => {
        if (item.category !== category) return item;
        const key = `${channel}Enabled` as const;
        return {
          ...item,
          [key]: !item[key],
        };
      })
    );
    setNotifFeedback({
      message: `Updated ${channel.toUpperCase()} preferences for ${target.label}. Synchronized to cloud preference vault.`,
      type: "success",
    });
  };

  const handleSendTestNotification = (
    channel: NotificationChannel,
    category: NotificationPreferenceCategory
  ) => {
    setIsSendingTestNotif(true);
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const uniqueId = `outbox-demo-${Date.now().toString().slice(-4)}`;

    const newItem = {
      id: uniqueId,
      channel,
      recipient: channel === "EMAIL" ? "sarah.jenkins@example.com" : "+14165550198",
      subject:
        category === "DISPATCH_ALERTS"
          ? "Skilled Hire: Technician Arriving Soon"
          : "Skilled Hire: Verified Service Invoice",
      preview:
        category === "DISPATCH_ALERTS"
          ? "Marcus is 3 minutes away from your property. Please ensure driveway access is clear."
          : "Your paid invoice #INV-99214 for $185.00 CAD has been settled. Warranty coverage is now active for 365 days.",
      category,
      status: "DELIVERED" as OutboxStatus,
      sentAt: `Today, ${timeStr}`,
      idempotencyKey: `evt:test:${channel.toLowerCase()}:${uniqueId}`,
    };

    setTimeout(() => {
      setCustomerOutbox((prev) => [newItem, ...prev]);
      setIsSendingTestNotif(false);
      setNotifFeedback({
        message: `Dispatched test ${channel} notification via Transactional Outbox Worker (Idempotency Key: ${newItem.idempotencyKey}).`,
        type: "success",
      });
    }, 400);
  };

  return (
    <Shell
      title="Homeowner Service & Protection Hub"
      subtitle="Apple-inspired home care journey: instant trade search, transparent upfront estimates, live technician arrival tracking, structured sign-offs, 365-day workmanship warranty, and Digital Property Passport."
      eyebrow="SKILLED HIRE · ONTARIO LICENSED SERVICES"
    >
      {/* Customer Account & Property Switcher Bar */}
      <div
        style={{
          background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          border: "1px solid #e2e8f0",
          borderRadius: 20,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.03)",
        }}
      >
        {/* Left: Customer Info */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 17,
              boxShadow: "0 2px 6px rgba(29, 78, 216, 0.25)",
            }}
          >
            SJ
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 16, color: "#0f172a" }}>
                {customerProfile.fullName}
              </strong>
              <Badge tone="blue">Verified Homeowner</Badge>
              <Badge tone="neutral">MFA Active</Badge>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, display: "flex", gap: 12 }}>
              <span>✉️ {customerProfile.email}</span>
              <span>📞 {customerProfile.phoneNumber}</span>
              <span style={{ color: "#059669", fontWeight: 700 }}>
                🎁 ${(customerProfile.courtesyCreditBalanceCents / 100).toFixed(0)} Reward Credit
              </span>
            </div>
          </div>
        </div>

        {/* Center: Property Selector Switcher */}
        <div
          style={{
            background: "#fff",
            border: "1.5px solid #cbd5e1",
            borderRadius: 14,
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 320,
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
          }}
        >
          <span style={{ fontSize: 20 }}>
            {properties.find((p) => p.id === selectedPropertyId)?.propertyType === "CONDO"
              ? "🏢"
              : "🏡"}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Active Service Property
            </div>
            <select
              aria-label="Active service property"
              value={selectedPropertyId}
              onChange={(e) => handleSelectProperty(e.target.value)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 14,
                fontWeight: 700,
                color: "#0f172a",
                cursor: "pointer",
                padding: "2px 0",
                width: "100%",
                outline: "none",
              }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.addressLine1} ({p.city}, {p.postalCode}) {p.isPrimary ? "★ Primary" : ""}
                </option>
              ))}
            </select>
          </div>
          <Badge tone="blue">
            {properties.find((p) => p.id === selectedPropertyId)?.propertyType ?? "DETACHED"}
          </Badge>
        </div>

        {/* Right: Quick Actions & Draft Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {draftSavedAt && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 9999,
                padding: "4px 10px",
                fontSize: 12,
                color: "#166534",
                fontWeight: 600,
              }}
              title="Booking draft is continuously auto-saved and synced"
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                }}
              />
              Draft Saved ({draftSavedAt})
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsAddPropertyModalOpen(true)}
          >
            + Add Property
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsProfileModalOpen(true)}
          >
            👤 Profile
          </Button>
        </div>
      </div>

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
              value: "quotes",
              label: "Quote & Scope",
              icon: "📋",
              badge:
                activeQuote.status === "SUBMITTED"
                  ? "Action Needed"
                  : activeChangeOrder.status === "SUBMITTED"
                    ? "Change Order"
                    : "Approved",
            },
            {
              value: "messages",
              label: "Messages & Relay",
              icon: "💬",
              badge:
                unreadMessagesCount > 0
                  ? `${unreadMessagesCount} New`
                  : "Bridge Ready",
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
            {
              value: "security",
              label: "Security & MFA",
              icon: "🔒",
              badge: mfaActive ? "2FA Active" : "Protected",
            },
            {
              value: "payments",
              label: "Payments & Invoices",
              icon: "💳",
              badge: milestones.some((m) => m.status === "PENDING") ? "Due" : "Paid",
            },
            {
              value: "preferences",
              label: "Alerts & Outbox",
              icon: "🔔",
              badge: "Outbox Live",
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

              {/* 1. Selected Property Banner */}
              {(() => {
                const activeProp =
                  properties.find((p) => p.id === selectedPropertyId) ?? properties[0]!;
                return (
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>
                          {activeProp.propertyType === "CONDO" ? "🏢" : "🏡"}
                        </span>
                        <strong style={{ fontSize: 14, color: "#0f172a" }}>
                          Service Location: {activeProp.label}
                        </strong>
                        {activeProp.isPrimary && <Badge tone="blue">Primary Home</Badge>}
                        <Badge tone="neutral">{activeProp.propertyType}</Badge>
                      </div>
                      <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                        {activeProp.addressLine1}
                        {activeProp.unitNumber ? `, ${activeProp.unitNumber}` : ""},{" "}
                        {activeProp.city}, ON {activeProp.postalCode}
                        {activeProp.accessNotes && (
                          <span style={{ marginLeft: 8, color: "#64748b" }}>
                            · Access: {activeProp.accessNotes}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsAddPropertyModalOpen(true)}
                      >
                        + Switch / Add Property
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* 2. Equipment Passport Picker */}
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                    Digital Equipment Passport · Select Target Equipment
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsAddEquipmentModalOpen(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#1d4ed8",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    + Register New Equipment
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 10,
                  }}
                >
                  {(propertyEquipmentMap[selectedPropertyId] ?? []).map((eq) => {
                    const isSelected = selectedEquipmentId === eq.id;
                    return (
                      <div
                        key={eq.id}
                        onClick={() => setSelectedEquipmentId(eq.id)}
                        style={{
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: `1.5px solid ${isSelected ? "#1d4ed8" : "#e2e8f0"}`,
                          background: isSelected ? "#eff6ff" : "#fff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: 4,
                          }}
                        >
                          <strong style={{ fontSize: 14, color: "#0f172a" }}>
                            {eq.name}
                          </strong>
                          <Badge tone={eq.warrantyStatus === "ACTIVE" ? "green" : "neutral"}>
                            {eq.warrantyStatus === "ACTIVE" ? "Warranty Active" : eq.warrantyStatus}
                          </Badge>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {eq.manufacturer && <span>Mfg: {eq.manufacturer} · </span>}
                          {eq.modelNumber && <span>Model: {eq.modelNumber}</span>}
                        </div>
                        {eq.serialNumber && (
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            S/N: {eq.serialNumber}
                            {eq.installedOn && ` · Installed: ${eq.installedOn}`}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div
                    onClick={() => setSelectedEquipmentId("")}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: `1.5px solid ${selectedEquipmentId === "" ? "#1d4ed8" : "#e2e8f0"}`,
                      background: selectedEquipmentId === "" ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                    }}
                  >
                    <strong style={{ fontSize: 14, color: "#0f172a" }}>
                      Unlisted / General Assessment
                    </strong>
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      Technician will inspect and register asset on-site
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Trade Symptom Checklist */}
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  Common Diagnostic Symptoms (Select all that apply)
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    "Compressor Humming / Fan Stalled",
                    "Indoor Air Warm / Not Cooling",
                    "Thermostat Blank / No Power",
                    "Water Pooling Around Unit",
                    "Unusual Rattling or Buzzing",
                    "Breaker Frequently Tripping",
                    "Ice Forming on Refrigerant Line",
                  ].map((sym) => {
                    const isChecked = symptomSelections.includes(sym);
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => {
                          setSymptomSelections((prev) =>
                            isChecked ? prev.filter((s) => s !== sym) : [...prev, sym],
                          );
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 9999,
                          border: `1px solid ${isChecked ? "#1d4ed8" : "#cbd5e1"}`,
                          background: isChecked ? "#dbeafe" : "#f8fafc",
                          color: isChecked ? "#1e40af" : "#334155",
                          fontSize: 12,
                          fontWeight: isChecked ? 700 : 500,
                          cursor: "pointer",
                          transition: "all 0.12s ease",
                        }}
                      >
                        {isChecked ? "✓ " : "+ "}
                        {sym}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Age & Filter Condition */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                    Approximate System Age
                  </label>
                  <select
                    aria-label="Approximate system age"
                    value={equipmentAgeYears}
                    onChange={(e) => setEquipmentAgeYears(e.target.value)}
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      background: "#fff",
                    }}
                  >
                    <option value="1-3 years">1 - 3 years (Modern / In Warranty)</option>
                    <option value="4-7 years">4 - 7 years (Mid-life)</option>
                    <option value="8-12 years">8 - 12 years (Mature)</option>
                    <option value="13+ years">13+ years (Replacement candidate)</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                    Air Filter Last Replaced
                  </label>
                  <select
                    aria-label="Air filter last replaced"
                    value={filterLastChanged}
                    onChange={(e) => setFilterLastChanged(e.target.value)}
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      background: "#fff",
                    }}
                  >
                    <option value="Within 30 days">Within past 30 days</option>
                    <option value="1-3 months ago">1 - 3 months ago</option>
                    <option value="4-6 months ago">4 - 6 months ago</option>
                    <option value="Over 6 months / Unsure">Over 6 months / Unsure</option>
                  </select>
                </div>
              </div>

              {/* 5. Issue Description & Urgency */}
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
                    Service Urgency & Evidence SLA
                  </label>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button
                      variant={urgency === "STANDARD" ? "primary" : "secondary"}
                      onClick={() => setUrgency("STANDARD")}
                    >
                      Standard Appointment (Scheduled Window)
                    </Button>
                    <Button
                      variant={urgency === "EMERGENCY" ? "danger" : "secondary"}
                      onClick={() => setUrgency("EMERGENCY")}
                    >
                      {slotAvailability?.emergencyOption?.evidenceSupported
                        ? `⚡ Emergency Priority Dispatch (~45m On-Call SLA)`
                        : `⚡ Emergency Priority (${slotAvailability?.emergencyOption?.badge ?? "Evidence Verification"})`}
                    </Button>
                  </div>
                  {urgency === "EMERGENCY" && (
                    <Callout
                      tone={slotAvailability?.emergencyOption?.evidenceSupported ? "success" : "info"}
                      title={
                        slotAvailability?.emergencyOption?.evidenceSupported
                          ? "Evidence-Backed Emergency Coverage"
                          : "Truthful SLA Notice"
                      }
                    >
                      {slotAvailability?.emergencyOption?.evidenceSupported
                        ? `✓ Verified on-call journeyperson currently active in postal FSA ${postalCode.slice(0, 3)}. Immediate priority dispatch enabled.`
                        : `Emergency arrival times are computed from actual active on-call technicians without unverified arrival promises.`}
                    </Callout>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 10 }}>
                  <Button variant="primary" size="lg" onClick={() => setBookingStep(2)}>
                    Continue to Slot Selection →
                  </Button>
                  {draftSavedAt && (
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      ☁️ Draft auto-saved ({draftSavedAt})
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {bookingStep === 2 && (
            <div style={{ display: "grid", gap: 20 }}>
              {/* Evidence-Backed Arrival Window Selector */}
              <Card tone="white" padding="lg">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <Badge tone="blue">Evidence-Backed Dispatch</Badge>
                    <h2 style={{ fontSize: 22, margin: "6px 0 2px" }}>
                      Select Arrival Window · {postalCode.slice(0, 3).toUpperCase()} Territory
                    </h2>
                    <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                      {slotAvailability?.reason ??
                        "Real-time schedule verification across verified Ontario journeypersons. No overbooking."}
                    </p>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: "#f8fafc",
                      padding: "6px 12px",
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                      Postal FSA:
                    </span>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      style={{
                        width: 90,
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        fontWeight: 700,
                        fontSize: 13,
                        textTransform: "uppercase",
                      }}
                    />
                    <Status
                      tone={
                        slotAvailability?.availabilityConfidence === "HIGH"
                          ? "green"
                          : slotAvailability?.availabilityConfidence === "LIMITED"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {slotAvailability?.availabilityConfidence === "HIGH"
                        ? "High Capacity"
                        : slotAvailability?.availabilityConfidence === "LIMITED"
                          ? "Limited"
                          : "Verified"}
                    </Status>
                  </div>
                </div>

                {/* Exclusive Hold Live Countdown Banner */}
                {activeHold && (
                  <div
                    style={{
                      background: holdRemainingSeconds > 60 ? "#ecfdf5" : "#fef2f2",
                      border: `1.5px solid ${holdRemainingSeconds > 60 ? "#10b981" : "#ef4444"}`,
                      borderRadius: 16,
                      padding: "14px 18px",
                      marginBottom: 16,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 24 }}>🔒</span>
                      <div>
                        <strong
                          style={{
                            fontSize: 14,
                            color: holdRemainingSeconds > 60 ? "#065f46" : "#991b1b",
                          }}
                        >
                          Exclusive Slot Lease Active · Double-Booking Protected
                        </strong>
                        <p
                          style={{
                            margin: "2px 0 0",
                            fontSize: 12,
                            color: holdRemainingSeconds > 60 ? "#047857" : "#b91c1c",
                          }}
                        >
                          Hold Token:{" "}
                          <code style={{ fontSize: 11 }}>
                            {activeHold.holdToken.slice(0, 16)}...
                          </code>{" "}
                          · Assigned: {assignedTechName}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                        }}
                      >
                        Lease Expires In
                      </span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 22,
                          fontWeight: 900,
                          color: holdRemainingSeconds > 60 ? "#059669" : "#dc2626",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {Math.floor(holdRemainingSeconds / 60)}:
                        {(holdRemainingSeconds % 60).toString().padStart(2, "0")}
                      </p>
                    </div>
                  </div>
                )}

                {/* Capacity Saturation & Availability Metrics */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                      OPEN CAPACITY
                    </span>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 18,
                        fontWeight: 800,
                        color: "#0f172a",
                      }}
                    >
                      {slotAvailability?.availableCapacity ?? 2} Journeypersons
                    </p>
                  </div>
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                      CONFIDENCE LEVEL
                    </span>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 18,
                        fontWeight: 800,
                        color: "#059669",
                      }}
                    >
                      {slotAvailability?.availabilityConfidence ?? "HIGH"}
                    </p>
                  </div>
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                      EMERGENCY ON-CALL
                    </span>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 18,
                        fontWeight: 800,
                        color: "#1d4ed8",
                      }}
                    >
                      {slotAvailability?.emergencyOption?.evidenceSupported
                        ? "✓ 45m On-Call"
                        : "Standard Windows"}
                    </p>
                  </div>
                </div>

                {reserveMessage && (
                  <div style={{ marginBottom: 12 }}>
                    <Callout tone="success" title="Slot Lease Reserved">
                      {reserveMessage}
                    </Callout>
                  </div>
                )}

                {/* Dynamic Arrival Window List */}
                <div style={{ display: "grid", gap: 10 }}>
                  {(slotAvailability?.alternativeSlots ?? [
                    {
                      id: "today-13-15",
                      label: "Today · 1:00–3:00 PM (Afternoon Window)",
                      day: "Today",
                      time: "1:00 PM – 3:00 PM",
                      guaranteed: false,
                      demandLevel: "NORMAL" as const,
                      badge: "2 Technicians Open",
                      availableCapacity: 2,
                      confidence: "HIGH" as const,
                    },
                    {
                      id: "today-16-18",
                      label: "Today · 4:00–6:00 PM (Late Window)",
                      day: "Today",
                      time: "4:00 PM – 6:00 PM",
                      guaranteed: false,
                      demandLevel: "NORMAL" as const,
                      badge: "1 Technician Open",
                      availableCapacity: 1,
                      confidence: "LIMITED" as const,
                    },
                    {
                      id: "tomorrow-09-11",
                      label: "Tomorrow · 9:00–11:00 AM (Recommended Morning)",
                      day: "Tomorrow",
                      time: "9:00 AM – 11:00 AM",
                      guaranteed: false,
                      demandLevel: "LOW" as const,
                      badge: "3 Technicians Open",
                      availableCapacity: 3,
                      confidence: "HIGH" as const,
                    },
                    {
                      id: "tomorrow-14-16",
                      label: "Tomorrow · 2:00–4:00 PM (Afternoon Window)",
                      day: "Tomorrow",
                      time: "2:00 PM – 4:00 PM",
                      guaranteed: false,
                      demandLevel: "NORMAL" as const,
                      badge: "2 Technicians Open",
                      availableCapacity: 2,
                      confidence: "HIGH" as const,
                    },
                  ]).map((slot) => {
                    const isSelected = selectedSlot === slot.id;
                    return (
                      <div
                        key={slot.id}
                        onClick={() => handleSelectSlot(slot.id)}
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
                              {slot.day} · 2-Hour Arrival Window · {slot.badge}
                            </p>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {slot.availableCapacity !== undefined && (
                            <Badge
                              tone={
                                slot.availableCapacity >= 2
                                  ? "green"
                                  : slot.availableCapacity === 1
                                    ? "amber"
                                    : "neutral"
                              }
                            >
                              {slot.availableCapacity > 0
                                ? `${slot.availableCapacity} Open`
                                : "Standby"}
                            </Badge>
                          )}
                          <Status tone={isSelected ? "blue" : "neutral"}>
                            {isSelected
                              ? activeHold
                                ? "Held (15m Lease)"
                                : "Selected Window"
                              : "Available"}
                          </Status>
                        </div>
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

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActiveTab("messages")}
                >
                  💬 Message Marcus {unreadMessagesCount > 0 ? `(${unreadMessagesCount})` : ""}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsMaskedBridgeModalOpen(true)}
                >
                  📞 Encrypted Proxy Call
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsNoShowModalOpen(true)}
                >
                  ⚠️ Report Delay / No-Show
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setIsCancelModalOpen(true)}
                >
                  ✕ Cancel Appointment
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

          {/* Recovery Choice Feedback Alert */}
          {recoveryChoiceFeedback && (
            <div style={{ marginTop: 20 }}>
              <Callout tone="success" title="Recovery Action Confirmed">
                {recoveryChoiceFeedback}
              </Callout>
            </div>
          )}

          {/* Cancellation Result Banner */}
          {cancellationResult && (
            <div style={{ marginTop: 20 }}>
              <Callout
                tone="warning"
                title={`Appointment Cancelled (${cancellationResult.policyType.replace(/_/g, " ")})`}
              >
                <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <p style={{ margin: 0 }}>{cancellationResult.explanation}</p>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 4,
                      fontWeight: 700,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>
                      Refund Amount: $
                      {(cancellationResult.refundCents / 100).toFixed(2)} CAD
                    </span>
                    <span>
                      Cancellation Fee: $
                      {(cancellationResult.feeCents / 100).toFixed(2)} CAD
                    </span>
                    <span>
                      Processed At: {cancellationResult.cancelledAt}
                    </span>
                  </div>
                </div>
              </Callout>
            </div>
          )}

          {/* Active Dispatch Exception & SLA Alert */}
          {activeDispatchException && (
            <div
              style={{
                marginTop: 20,
                background:
                  activeDispatchException.status === "ESCALATED"
                    ? "#fef2f2"
                    : "#fffbeb",
                border: `2px solid ${
                  activeDispatchException.status === "ESCALATED"
                    ? "#f87171"
                    : "#f59e0b"
                }`,
                borderRadius: 16,
                padding: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Badge
                      tone={
                        activeDispatchException.status === "ESCALATED"
                          ? "danger"
                          : "amber"
                      }
                    >
                      {activeDispatchException.type.replace(/_/g, " ")}
                    </Badge>
                    <Badge tone="blue">
                      SLA Timer:{" "}
                      {Math.floor(
                        activeDispatchException.slaRemainingSeconds / 60,
                      )}
                      :
                      {(activeDispatchException.slaRemainingSeconds % 60)
                        .toString()
                        .padStart(2, "0")}
                    </Badge>
                    <Badge tone="green">
                      +$25 Courtesy Credit Awarded
                    </Badge>
                  </div>
                  <h3
                    style={{
                      margin: "4px 0 2px",
                      fontSize: 18,
                      fontWeight: 800,
                      color: "#0f172a",
                    }}
                  >
                    Ontario On-Time Guarantee Activated
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                    {activeDispatchException.reason} We have credited $25.00
                    CAD to your account and prioritized recovery options.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsRecoveryModalOpen(true)}
                >
                  ⚡ Choose Recovery Option
                </Button>
              </div>
            </div>
          )}

          {/* Customer Service Guarantee & Courtesy Credits Wallet */}
          <div style={{ marginTop: 24 }}>
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
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span style={{ fontSize: 22 }}>🎁</span>
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                      Customer Courtesy Credits & Service Wallet
                    </h3>
                    <Badge tone="green">Ontario Guarantee</Badge>
                  </div>
                  <p
                    style={{
                      margin: "6px 0 0",
                      color: "#475569",
                      fontSize: 14,
                    }}
                  >
                    Skilled Hire guarantees prompt certified service. If a
                    technician fails to arrive or cancels outside policy,
                    credits are credited automatically with 1-year Ontario
                    Consumer Protection Act validity.
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#64748b",
                    }}
                  >
                    Available Wallet Balance
                  </span>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 28,
                      fontWeight: 900,
                      color: "#059669",
                    }}
                  >
                    ${(totalActiveCreditsCents / 100).toFixed(2)}{" "}
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      CAD
                    </span>
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {serviceCredits.map((cred) => (
                  <div
                    key={cred.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 16px",
                      background: "#f8fafc",
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <strong
                          style={{ fontSize: 14, color: "#0f172a" }}
                        >
                          {cred.reason}
                        </strong>
                        <Badge
                          tone={
                            cred.status === "ACTIVE" ? "green" : "neutral"
                          }
                        >
                          {cred.status}
                        </Badge>
                      </div>
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        ID: {cred.id} · Valid until:{" "}
                        {cred.expiresAt
                          ? new Date(cred.expiresAt).toLocaleDateString(
                              "en-CA",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )
                          : "12 Months"}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: "#059669",
                      }}
                    >
                      +${(cred.amountCents / 100).toFixed(2)} CAD
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Discovered Service Recommendations from Technician */}
          <div style={{ marginTop: 24 }}>
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
                    <span style={{ fontSize: 22 }}>💡</span>
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                      Services Discovered by Your Technician
                    </h3>
                    {recommendations.some((r) => r.jobId === "JOB-2026-4412" && r.status === "PROPOSED") && (
                      <Badge tone="amber">Action Needed</Badge>
                    )}
                  </div>
                  <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
                    During today&apos;s visit, your certified specialist discovered the following service need. You can approve it directly for completion today, schedule it for later, or decline.
                  </p>
                </div>
              </div>

              {recFeedbackNotice && (
                <div style={{ marginBottom: 16 }}>
                  <Callout tone="success" title="Decision Recorded">
                    {recFeedbackNotice}
                  </Callout>
                </div>
              )}

              <div style={{ display: "grid", gap: 16 }}>
                {recommendations.filter((r) => r.jobId === "JOB-2026-4412").map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      background:
                        rec.status === "ACCEPTED"
                          ? "#f0fdf4"
                          : rec.status === "DECLINED"
                            ? "#f8fafc"
                            : "#ffffff",
                      borderRadius: 18,
                      padding: 20,
                      border:
                        rec.status === "ACCEPTED"
                          ? "1px solid #86efac"
                          : rec.status === "DECLINED"
                            ? "1px solid #e2e8f0"
                            : "2px solid #bfdbfe",
                      boxShadow:
                        rec.status === "PROPOSED"
                          ? "0 4px 14px -2px rgba(29, 78, 216, 0.12)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={{ fontWeight: 800, fontSize: 17, color: "#0f172a" }}>
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
                                    : "blue"
                            }
                          >
                            {rec.status === "PROPOSED"
                              ? "⏳ AWAITING YOUR DECISION"
                              : rec.status === "ACCEPTED"
                                ? "✓ ACCEPTED"
                                : rec.status === "DECLINED"
                                  ? `✕ DECLINED (${rec.declineReason ?? "NO REASON"})`
                                  : "DEFERRED"}
                          </Badge>
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                          Discovered by {rec.technicianName} during diagnostic multimeter evaluation
                        </p>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                          Transparent Price (Parts & Certified Labour)
                        </span>
                        <p style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
                          ${(rec.estimatedCostCents / 100).toFixed(2)}{" "}
                          <span style={{ fontSize: 13, fontWeight: 600 }}>CAD</span>
                        </p>
                      </div>
                    </div>

                    <p style={{ margin: "0 0 14px", fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
                      {rec.description}
                    </p>

                    {/* Photo Evidence */}
                    {rec.evidencePhotos && rec.evidencePhotos.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                          Field Evidence Captured on Site:
                        </span>
                        <div style={{ display: "flex", gap: 10 }}>
                          {rec.evidencePhotos.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt="Capacitor meter reading"
                              style={{
                                width: 140,
                                height: 90,
                                objectFit: "cover",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Bar based on Status */}
                    {rec.status === "PROPOSED" && (
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                          background: "#f8fafc",
                          padding: "12px 16px",
                          borderRadius: 12,
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <Button
                          variant="primary"
                          onClick={() => handleOpenAcceptModal(rec)}
                        >
                          ✓ Accept Service (${(rec.estimatedCostCents / 100).toFixed(2)} CAD)
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleOpenDeclineModal(rec)}
                        >
                          ✕ Decline Service
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleDeferRecommendation(rec.id)}
                        >
                          ⏱ Remind Me in 60 Days
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelectedRecForDetail(rec)}
                        >
                          📋 View Audit Trail ({(rec.responses ?? []).length})
                        </Button>
                      </div>
                    )}

                    {rec.status === "ACCEPTED" && (
                      <div style={{ background: "#ecfdf5", padding: "12px 16px", borderRadius: 12, border: "1px solid #a7f3d0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065f46", fontWeight: 700, fontSize: 14 }}>
                            <span>✓</span>
                            <span>Service Accepted by You</span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedRecForDetail(rec)}
                          >
                            📋 View Audit Trail ({(rec.responses ?? []).length})
                          </Button>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#047857" }}>
                          {rec.homeownerResponseNotes || "Added to today's active visit. Marcus has been notified to proceed."}
                        </p>
                      </div>
                    )}

                    {rec.status === "DECLINED" && (
                      <div style={{ background: "#fef2f2", padding: "12px 16px", borderRadius: 12, border: "1px solid #fecaca" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#991b1b", fontWeight: 700, fontSize: 14 }}>
                            <span>✕</span>
                            <span>Service Declined: {rec.declineReason ?? "Budget / Other"}</span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedRecForDetail(rec)}
                          >
                            📋 View Audit Trail ({(rec.responses ?? []).length})
                          </Button>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#b91c1c" }}>
                          {rec.homeownerResponseNotes || "Recorded in your Property Service Passport so you and future technicians have a complete history."}
                        </p>
                      </div>
                    )}

                    {rec.status === "DEFERRED" && (
                      <div style={{ background: "#fffbeb", padding: "12px 16px", borderRadius: 12, border: "1px solid #fde68a" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#92400e", fontWeight: 700, fontSize: 14 }}>
                            <span>⏱</span>
                            <span>Follow-up Scheduled</span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedRecForDetail(rec)}
                          >
                            📋 View Audit Trail ({(rec.responses ?? []).length})
                          </Button>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#b45309" }}>
                          You asked to be reminded in 60 days before the seasonal temperature shift.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB: QUOTE REVIEW, CALL-OUT FEE & LABOUR-ONLY MATERIALS (SH-12 / #13)
         ------------------------------------------------------------- */}
      {activeTab === "quotes" && (
        <div style={{ display: "grid", gap: 24 }}>
          {/* Quote Feedback Banner */}
          {quoteFeedbackBanner && (
            <Callout tone={quoteFeedbackBanner.tone} title={quoteFeedbackBanner.title}>
              {quoteFeedbackBanner.message}
            </Callout>
          )}

          {/* Authoritative Quote Header Card */}
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
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Status
                    tone={
                      activeQuote.status === "ACCEPTED"
                        ? "green"
                        : activeQuote.status === "REJECTED"
                          ? "danger"
                          : "blue"
                    }
                  >
                    {activeQuote.status === "SUBMITTED"
                      ? "Quote Pending Approval"
                      : activeQuote.status === "ACCEPTED"
                        ? "Quote Approved & Locked"
                        : "Quote Declined"}
                  </Status>
                  <Badge tone="neutral">Quote #{activeQuote.id}</Badge>
                  <Badge tone="blue">Version {activeQuote.version}.0 (Authoritative)</Badge>
                  <Badge tone="green">TSSA & ESA Regulated Trade</Badge>
                </div>
                <h2 style={{ fontSize: 26, margin: "8px 0 4px", color: "#0f172a" }}>
                  High-Efficiency AC Diagnostic & Smart Thermostat Wiring
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  Booking Ref #{activeQuote.bookingRef} · 123 King Street W, Unit 1402, Toronto ON
                </p>
              </div>

              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Authorized Total (Taxes Incl.)
                </span>
                <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#0f172a" }}>
                  ${(activeQuote.customerTotalCents / 100).toFixed(2)}{" "}
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>CAD</span>
                </p>
                <span style={{ fontSize: 12, color: "#059669", fontWeight: 700 }}>
                  ✓ Guaranteed Maximum Price Lock
                </span>
              </div>
            </div>

            {/* Technician Credential Snapshot */}
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 14,
                padding: "14px 18px",
                border: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "#0284c7",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 16,
                  }}
                >
                  MV
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>
                      {activeQuote.technicianName}
                    </span>
                    <Badge tone="blue">Ontario Certified</Badge>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 13, color: "#475569" }}>
                    {activeQuote.technicianTrade} · License #{activeQuote.technicianLicense}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
                <span style={{ color: "#059669", fontWeight: 700 }}>★ 4.98 Rating</span>
                <span style={{ color: "#94a3b8" }}>|</span>
                <span style={{ color: "#475569" }}>WSIB Insured · $5M Commercial Liability</span>
              </div>
            </div>
          </Card>

          {/* Transparent Diagnostic Call-Out Fee Breakdown Banner */}
          <div
            style={{
              background: "linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)",
              borderRadius: 16,
              padding: 20,
              border: "1px solid #bbf7d0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "#10b981",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#065f46" }}>
                    Transparent Diagnostic Call-Out Fee: ${(activeQuote.diagnosticFeeCents / 100).toFixed(2)} CAD
                  </h3>
                  <Badge tone="green">100% Credited Toward Repair</Badge>
                  <Badge tone="neutral">Ontario Consumer Protection Act Compliant</Badge>
                </div>
                <p style={{ margin: "6px 0 10px", fontSize: 13, color: "#047857", lineHeight: 1.5 }}>
                  Under Skilled Hire transparent pricing rules, your initial call-out fee is isolated from repair labor and materials. 
                  When you approve today's repair, this full $129.00 amount is credited directly against total project labor.
                </p>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "#065f46" }}>
                  <span>✓ Licensed 313A Refrigeration Mechanic Dispatch</span>
                  <span>✓ Calibrated Multimeter & Manifold Gauge Testing</span>
                  <span>✓ 30-Day Re-Inspection Price Guarantee</span>
                </div>
              </div>
            </div>
          </div>

          {/* Itemized Breakdown Table Card */}
          <Card tone="white" padding="lg">
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 800, color: "#0f172a" }}>
                Itemized Workmanship & Materials Breakdown
              </h3>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                Authoritative backend line items with statutory customer-supplied materials segregation.
              </p>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "12px 8px", width: "14%" }}>Category</th>
                    <th style={{ padding: "12px 8px", width: "48%" }}>Item & Description</th>
                    <th style={{ padding: "12px 8px", width: "10%", textAlign: "center" }}>Qty</th>
                    <th style={{ padding: "12px 8px", width: "14%", textAlign: "right" }}>Unit Price</th>
                    <th style={{ padding: "12px 8px", width: "14%", textAlign: "right" }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {activeQuote.items.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: item.isCustomerSupplied ? "#fffbeb" : "transparent",
                      }}
                    >
                      <td style={{ padding: "14px 8px", verticalAlign: "top" }}>
                        <Badge
                          tone={
                            item.type === "DIAGNOSTIC"
                              ? "blue"
                              : item.type === "LABOUR"
                                ? "purple"
                                : item.type === "MATERIAL"
                                  ? item.isCustomerSupplied
                                    ? "amber"
                                    : "green"
                                  : item.type === "DISPOSAL"
                                    ? "neutral"
                                    : "neutral"
                          }
                        >
                          {item.type}
                        </Badge>
                      </td>
                      <td style={{ padding: "14px 8px", verticalAlign: "top" }}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{item.title}</div>
                        {item.description && (
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>
                            {item.description}
                          </div>
                        )}
                        {/* High-Visibility Labour-Only Materials Warning */}
                        {item.isCustomerSupplied && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: "8px 12px",
                              borderRadius: 8,
                              background: "#fef3c7",
                              border: "1px solid #fde68a",
                              color: "#92400e",
                              fontSize: 12,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <span>⚠️</span>
                            <span>{item.warrantyCaveat}</span>
                          </div>
                        )}
                        {!item.isCustomerSupplied && item.warrantyCaveat && (
                          <div style={{ fontSize: 12, color: "#059669", marginTop: 4 }}>
                            ✓ {item.warrantyCaveat}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "center", verticalAlign: "top" }}>
                        {item.quantity}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "right", verticalAlign: "top" }}>
                        {item.isCustomerSupplied ? (
                          <span style={{ color: "#d97706", fontWeight: 700 }}>$0.00 (Supplied)</span>
                        ) : (
                          `$${(item.unitPriceCents / 100).toFixed(2)}`
                        )}
                      </td>
                      <td
                        style={{
                          padding: "14px 8px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: item.isCustomerSupplied ? "#d97706" : "#0f172a",
                          verticalAlign: "top",
                        }}
                      >
                        ${(item.subtotalCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Divider />

            {/* Authoritative Financial Breakdown Columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 24,
                marginTop: 16,
              }}
            >
              {/* Payment Protection in Escrow Explanation */}
              <div
                style={{
                  background: "#f8fafc",
                  borderRadius: 14,
                  padding: 16,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>🛡️</span>
                  <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                    Skilled Hire Escrow Guarantee
                  </span>
                </div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
                  Your authorization holds funds securely in escrow. Milestone payments are strictly released to the
                  contractor only after you inspect and sign off on completion.
                </p>
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>Milestone 1 (Deposit & Assessment):</span>
                    <span style={{ fontWeight: 700 }}>$190.94 CAD</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>Milestone 2 (Capacitor & Thermostat Wiring):</span>
                    <span style={{ fontWeight: 700 }}>$318.24 CAD</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>Milestone 3 (Final Cooling Test & Sign-off):</span>
                    <span style={{ fontWeight: 700 }}>$127.29 CAD</span>
                  </div>
                </div>
              </div>

              {/* Subtotal Calculation Summary */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 14,
                  padding: 16,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#475569" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Diagnostic Call-Out Assessment:</span>
                    <span>${(activeQuote.diagnosticFeeCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Licensed Trade Labour:</span>
                    <span>${(activeQuote.laborSubtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>OEM Materials & Hardware:</span>
                    <span>${(activeQuote.materialsSubtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#d97706" }}>
                    <span>Customer-Supplied Ecobee Thermostat:</span>
                    <span style={{ fontWeight: 700 }}>$0.00 CAD</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Safe Hazardous Waste Disposal:</span>
                    <span>${(activeQuote.disposalSubtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Municipal Safety Notification:</span>
                    <span>${(activeQuote.permitsSubtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Trust & Platform Fee:</span>
                    <span>${(activeQuote.platformFeeCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Ontario Harmonized Sales Tax (HST 13%):</span>
                    <span>${(activeQuote.taxCents / 100).toFixed(2)}</span>
                  </div>
                  <div
                    style={{
                      borderTop: "2px solid #0f172a",
                      paddingTop: 8,
                      marginTop: 4,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 16,
                      fontWeight: 900,
                      color: "#0f172a",
                    }}
                  >
                    <span>Total Authoritative Quote:</span>
                    <span>${(activeQuote.customerTotalCents / 100).toFixed(2)} CAD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Statutory Customer-Supplied Materials Disclaimer & Acknowledgment Gate */}
            <div
              style={{
                marginTop: 24,
                background: "#fffbeb",
                border: "2px solid #fde68a",
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <span style={{ fontSize: 24 }}>⚖️</span>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: "#92400e" }}>
                    Statutory Notice: Labour-Only Warranty & Customer-Supplied Materials
                  </h4>
                  <p style={{ margin: "0 0 14px", fontSize: 13, color: "#78350f", lineHeight: 1.5 }}>
                    {activeQuote.customerSuppliedPartsCaveat}
                  </p>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      cursor: "pointer",
                      padding: "10px 14px",
                      background: "#ffffff",
                      borderRadius: 10,
                      border: "1px solid #fcd34d",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={activeQuote.customerSuppliedAcknowledged}
                      disabled={activeQuote.status !== "SUBMITTED"}
                      onChange={(e) =>
                        setActiveQuote((prev) => ({
                          ...prev,
                          customerSuppliedAcknowledged: e.target.checked,
                        }))
                      }
                      style={{ marginTop: 3, width: 18, height: 18, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      I explicitly acknowledge that hardware parts supplied by me (Ecobee Smart Thermostat) carry
                      labour-only warranty. Skilled Hire and technician Marcus Vance warranty the physical installation
                      workmanship for 365 days, but do not warranty the hardware unit itself.
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div
              style={{
                marginTop: 24,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
                paddingTop: 16,
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#64748b" }}>
                <span>🔒 256-bit SSL Encrypted Authorization</span>
                <span>·</span>
                <span>Idempotent Payment Hold</span>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {activeQuote.status === "SUBMITTED" ? (
                  <>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setIsDeclineQuoteModalOpen(true)}
                    >
                      ✕ Decline Quote
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!activeQuote.customerSuppliedAcknowledged}
                      onClick={() => {
                        setActiveQuote((prev) => ({
                          ...prev,
                          status: "ACCEPTED",
                        }));
                        setQuoteFeedbackBanner({
                          tone: "success",
                          title: "Quote Approved & Payment Milestones Scheduled",
                          message: `Quote #${activeQuote.id} accepted. Deposit hold authorized. Work scheduled with Marcus Vance.`,
                        });
                      }}
                    >
                      ✓ Approve Quote & Authorize ${(activeQuote.customerTotalCents / 100).toFixed(2)} CAD
                    </Button>
                  </>
                ) : activeQuote.status === "ACCEPTED" ? (
                  <Badge tone="green">✓ Quote Approved & Scheduled</Badge>
                ) : (
                  <Badge tone="danger">✕ Quote Declined ({activeQuote.declineReason ?? "Homeowner Decision"})</Badge>
                )}
              </div>
            </div>
          </Card>

          {/* Change Order Review with Photographic Discovery Evidence (SH-12) */}
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
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <Status
                    tone={
                      activeChangeOrder.status === "ACCEPTED"
                        ? "green"
                        : activeChangeOrder.status === "DECLINED"
                          ? "danger"
                          : "amber"
                    }
                  >
                    {activeChangeOrder.status === "SUBMITTED"
                      ? "Change Order Discovery Pending Review"
                      : activeChangeOrder.status === "ACCEPTED"
                        ? "Change Order Approved"
                        : "Change Order Declined"}
                  </Status>
                  <Badge tone="neutral">CO #{activeChangeOrder.id}</Badge>
                  <Badge tone="blue">On-Site Discovery</Badge>
                </div>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
                  {activeChangeOrder.reason}
                </h3>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                  Discovered by Marcus Vance · {activeChangeOrder.discoveredAt}
                </p>
              </div>

              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Change Order Adjustment
                </span>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
                  +${(activeChangeOrder.totalCents / 100).toFixed(2)} CAD
                </p>
              </div>
            </div>

            <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.6, margin: "0 0 16px" }}>
              {activeChangeOrder.explanation}
            </p>

            {/* Photographic Discovery Evidence Gallery */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: "#475569" }}>
                Photographic Discovery Evidence ({activeChangeOrder.attachmentPhotos.length} Photos Captured)
              </h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                {activeChangeOrder.attachmentPhotos.map((photo, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedPhotoForPreview(photo)}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "#f8fafc",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        height: 180,
                        backgroundImage: `url(${photo.url})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          bottom: 8,
                          right: 8,
                          background: "rgba(15, 23, 42, 0.8)",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: 6,
                        }}
                      >
                        🔍 Click to Zoom
                      </div>
                    </div>
                    <div style={{ padding: 12 }}>
                      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                        {photo.caption}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{photo.metadata}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Change Order Scope Items */}
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#475569", marginBottom: 8 }}>
                Itemized Discovery Scope:
              </div>
              {activeChangeOrder.items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: i < activeChangeOrder.items.length - 1 ? "1px dashed #cbd5e1" : "none",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#1e293b" }}>{it.title}</span>
                  <span style={{ fontWeight: 700 }}>${(it.subtotalCents / 100).toFixed(2)}</span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  marginTop: 6,
                  borderTop: "1px solid #e2e8f0",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                <span>Total Scope Adjustment (+13% HST):</span>
                <span>+${(activeChangeOrder.totalCents / 100).toFixed(2)} CAD</span>
              </div>
            </div>

            {/* Change Order Decision Buttons */}
            {activeChangeOrder.status === "SUBMITTED" ? (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsDeclineCoModalOpen(true)}
                >
                  ✕ Decline (Maintain Original Scope)
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setActiveChangeOrder((prev) => ({
                      ...prev,
                      status: "ACCEPTED",
                    }));
                    setQuoteFeedbackBanner({
                      tone: "success",
                      title: "Change Order Approved",
                      message: `Change order approved. Milestone of $${(activeChangeOrder.totalCents / 100).toFixed(2)} CAD appended to escrow schedule.`,
                    });
                  }}
                >
                  ✓ Approve Scope Adjustment (+${(activeChangeOrder.totalCents / 100).toFixed(2)} CAD)
                </Button>
              </div>
            ) : activeChangeOrder.status === "ACCEPTED" ? (
              <Callout tone="success" title="Change Order Authorized">
                This adjustment was authorized. Marcus has been instructed to complete the condensate union repair.
              </Callout>
            ) : (
              <Callout tone="warning" title="Change Order Declined">
                You declined this change order ({activeChangeOrder.declineReason ?? "Customer Choice"}). Marcus will proceed with only the originally approved scope.
              </Callout>
            )}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                    Field Photographic Evidence
                  </h3>
                  <Badge tone="green">🛡️ SHA-256 & ClamAV Verified</Badge>
                </div>
                <Grid columns="repeat(auto-fit, minmax(240px, 1fr))">
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 14,
                      background: "#fffbeb",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Badge tone="amber">BEFORE WORK</Badge>
                      <Badge tone="green">✓ AV Clean</Badge>
                    </div>
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
                    <span style={{ fontSize: 11, color: "#64748b", display: "block", marginTop: 4 }}>
                      evidence/inspection/tenant-acme/2026/10/photo-before.jpg (Signed 15m lease)
                    </span>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 14,
                      background: "#ecfdf5",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Badge tone="green">AFTER WORK</Badge>
                      <Badge tone="green">✓ AV Clean</Badge>
                    </div>
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
                    <span style={{ fontSize: 11, color: "#64748b", display: "block", marginTop: 4 }}>
                      evidence/completion/tenant-acme/2026/10/photo-after.jpg (Signed 15m lease)
                    </span>
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

            {/* Discovered Services & Recommended Maintenance History Ledger */}
            <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid #e2e8f0" }}>
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
                  <h4 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                    Discovered Services & Maintenance Recommendations Ledger
                  </h4>
                  <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                    Audited lifetime record of on-site issues discovered by certified technicians and your authorization decisions.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Badge tone="blue">{recommendations.length} Total Discovered</Badge>
                  <Badge tone="green">
                    {recommendations.filter((r) => r.status === "ACCEPTED" || r.status === "CONVERTED").length} Approved
                  </Badge>
                  <Badge tone="amber">
                    {recommendations.filter((r) => r.status === "PROPOSED").length} Pending
                  </Badge>
                </div>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 16,
                      background:
                        rec.status === "ACCEPTED" || rec.status === "CONVERTED"
                          ? "#f0fdf4"
                          : rec.status === "DECLINED"
                            ? "#f8fafc"
                            : rec.status === "DEFERRED"
                              ? "#fffbeb"
                              : "#ffffff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                          <strong style={{ fontSize: 15, color: "#0f172a" }}>{rec.title}</strong>
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
                              rec.status === "ACCEPTED" || rec.status === "CONVERTED"
                                ? "green"
                                : rec.status === "DECLINED"
                                  ? "danger"
                                  : rec.status === "DEFERRED"
                                    ? "amber"
                                    : "blue"
                            }
                          >
                            {rec.status === "PROPOSED"
                              ? "⏳ ACTION REQUIRED"
                              : rec.status === "ACCEPTED"
                                ? "✓ APPROVED"
                                : rec.status === "CONVERTED"
                                  ? "🔄 CONVERTED TO JOB"
                                  : rec.status === "DECLINED"
                                    ? `✕ DECLINED (${rec.declineReason ?? "NO REASON"})`
                                    : "⏱ DEFERRED"}
                          </Badge>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                          Discovered on {new Date(rec.createdAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })} · {rec.technicianName} ({rec.contractorName})
                        </p>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                          ${(rec.estimatedCostCents / 100).toFixed(2)} CAD
                        </span>
                      </div>
                    </div>

                    <p style={{ margin: "4px 0 10px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                      {rec.description}
                    </p>

                    {rec.homeownerResponseNotes && (
                      <div
                        style={{
                          background: "rgba(0, 0, 0, 0.03)",
                          padding: "8px 12px",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#475569",
                          marginBottom: 10,
                        }}
                      >
                        <strong>Homeowner Response:</strong> {rec.homeownerResponseNotes}
                        {rec.respondedAt && (
                          <span style={{ color: "#94a3b8", marginLeft: 6 }}>
                            ({new Date(rec.respondedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })})
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedRecForDetail(rec)}
                      >
                        📋 View Evidence & Full Audit Trail ({(rec.responses ?? []).length} Events)
                      </Button>

                      {rec.status === "PROPOSED" && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleOpenAcceptModal(rec)}
                          >
                            ✓ Approve & Schedule
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenDeclineModal(rec)}
                          >
                            ✕ Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

      {/* -------------------------------------------------------------
          TAB 6: SECURITY & PRODUCTION IDENTITY (SH-03)
         ------------------------------------------------------------- */}
      {activeTab === "security" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Security Status Overview Card */}
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
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone="blue">Production Identity</Badge>
                  <Badge tone="green">Email Verified</Badge>
                  <Status tone={mfaActive ? "green" : "amber"}>
                    {mfaActive ? "2FA Protected" : "Standard Auth"}
                  </Status>
                </div>
                <h2 style={{ fontSize: 24, margin: "8px 0 2px" }}>
                  Security, MFA & Session Management
                </h2>
                <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
                  Multi-factor authentication, distributed brute-force abuse protection, and session revocation.
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Abuse Shield
                </span>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#059669" }}>
                  🛡️ 5-Attempt Lockout
                </p>
              </div>
            </div>

            {/* Quick Metrics */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginTop: 16,
              }}
            >
              <div
                style={{
                  background: "#f8fafc",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  AUTHENTICATOR (TOTP)
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: mfaActive ? "#059669" : "#d97706" }}>
                  {mfaActive ? "✓ Enabled" : "Setup Recommended"}
                </p>
              </div>
              <div
                style={{
                  background: "#f8fafc",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  ACTIVE SESSIONS
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                  {activeSessions.length} Devices
                </p>
              </div>
              <div
                style={{
                  background: "#f8fafc",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  SESSION ROTATION
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#1d4ed8" }}>
                  Active (7-Day Leases)
                </p>
              </div>
              <div
                style={{
                  background: "#f8fafc",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  PASSWORD POLICY
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                  Min 12 Chars · Scrypt
                </p>
              </div>
            </div>
          </Card>

          {/* Two-Factor Authentication Enrollment & Management */}
          <Card tone="white" padding="lg">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                  Two-Factor Authentication (2FA)
                </h3>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                  Protect your home service account, quotes, and payment methods with RFC 6238 TOTP authenticator.
                </p>
              </div>
              <Button
                variant={mfaActive ? "secondary" : "primary"}
                onClick={() => setMfaSetupOpen(!mfaSetupOpen)}
              >
                {mfaActive ? "Manage Authenticator" : "Setup 2FA Authenticator →"}
              </Button>
            </div>

            {mfaFeedback && (
              <div style={{ marginBottom: 14 }}>
                <Callout tone="success" title="MFA Status Updated">
                  {mfaFeedback}
                </Callout>
              </div>
            )}

            {mfaSetupOpen && (
              <div
                style={{
                  background: "#f8fafc",
                  borderRadius: 16,
                  padding: 20,
                  border: "1px solid #e2e8f0",
                  display: "grid",
                  gap: 16,
                }}
              >
                <div>
                  <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>
                    Step 1: Scan QR or Enter Secret Key in Authenticator App
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                    Compatible with Google Authenticator, 1Password, Apple Passwords, or Authy.
                  </p>
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "8px 12px",
                      marginTop: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <code style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", letterSpacing: 1 }}>
                      {mfaSecret}
                    </code>
                    <Badge tone="blue">Base32 Secret</Badge>
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>
                    Step 2: Emergency Single-Use Recovery Codes
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                    Keep these backup codes in a safe place. Each code can be used once if you lose device access.
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {mfaBackupCodes.map((code) => (
                      <div
                        key={code}
                        style={{
                          background: "#fff",
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          fontFamily: "monospace",
                          fontSize: 12,
                          textAlign: "center",
                          fontWeight: 700,
                        }}
                      >
                        {code}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                      Step 3: Enter 6-Digit Code from App
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="e.g. 549201"
                      value={mfaInputCode}
                      onChange={(e) => setMfaInputCode(e.target.value.replace(/\D/g, ""))}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontSize: 16,
                        fontWeight: 700,
                        letterSpacing: 2,
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    disabled={mfaInputCode.length !== 6}
                    onClick={() => {
                      setMfaActive(true);
                      setMfaFeedback("✓ 2FA Authenticator verified and activated. Two-factor challenge now required for account logins.");
                      setMfaSetupOpen(false);
                      setMfaInputCode("");
                    }}
                  >
                    Verify & Enable 2FA
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Active Device Sessions Card */}
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
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                  Active Device Sessions
                </h3>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                  Devices currently signed into your account. Older sessions are strictly isolated and lease-expired.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setActiveSessions((prev) => prev.filter((s) => s.isCurrent));
                  setRevokeAllFeedback("✓ All other sessions globally revoked. Access tokens invalidated immediately.");
                }}
              >
                Sign Out All Other Devices
              </Button>
            </div>

            {revokeAllFeedback && (
              <div style={{ marginBottom: 14 }}>
                <Callout tone="info" title="Global Session Revocation">
                  {revokeAllFeedback}
                </Callout>
              </div>
            )}

            <div style={{ display: "grid", gap: 10 }}>
              {activeSessions.map((sess) => (
                <div
                  key={sess.id}
                  style={{
                    background: sess.isCurrent ? "#eff6ff" : "#f8fafc",
                    border: `1.5px solid ${sess.isCurrent ? "#bfdbfe" : "#e2e8f0"}`,
                    borderRadius: 14,
                    padding: "14px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{sess.device.includes("iPhone") ? "📱" : "💻"}</span>
                    <div>
                      <strong style={{ fontSize: 14, color: "#0f172a" }}>
                        {sess.device}
                      </strong>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                        IP: {sess.ip} · {sess.lastActive}
                      </p>
                    </div>
                  </div>
                  <div>
                    {sess.isCurrent ? (
                      <Badge tone="blue">This Device</Badge>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setActiveSessions((prev) => prev.filter((s) => s.id !== sess.id))
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeTab === "payments" && (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800 }}>
                Transparent Milestone Payments & Invoices
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                Pay strictly upon milestone fulfillment. Under Ontario home service standards, amounts are locked server-side with zero escrow withholding and instant receipt issuance.
              </p>
            </div>
            <Badge tone="blue">Stripe Protected</Badge>
          </div>

          {checkoutFeedback && (
            <Callout
              tone={checkoutFeedback.includes("Failed") ? "danger" : "success"}
              title="Payment Status Update"
            >
              {checkoutFeedback}
            </Callout>
          )}

          {/* Milestone Schedule Cards */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Active Job Milestones (JOB-2026-4412)
                </h3>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Contractor: MapleShield Climate Services · Verified TSSA / OCOT
                </span>
              </div>
              <Badge tone={milestones.every((m) => m.status === "PAID") ? "green" : "amber"}>
                {milestones.every((m) => m.status === "PAID") ? "All Milestones Paid" : "Payment Due"}
              </Badge>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {milestones.map((ms, idx) => (
                <div
                  key={ms.id}
                  style={{
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: `1.5px solid ${ms.status === "PAID" ? "#bbf7d0" : "#cbd5e1"}`,
                    background: ms.status === "PAID" ? "#f0fdf4" : "#ffffff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                        STAGE {idx + 1}
                      </span>
                      <strong style={{ fontSize: 15, color: "#0f172a" }}>{ms.title}</strong>
                      <Badge tone={ms.status === "PAID" ? "green" : "amber"}>
                        {ms.status === "PAID" ? "✓ PAID" : "PENDING AUTHORIZATION"}
                      </Badge>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                      Trigger: {ms.trigger}
                      {ms.paidAt && ` · Paid: ${ms.paidAt} (Ref: ${ms.transactionRef})`}
                    </p>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: ms.status === "PAID" ? "#16a34a" : "#0f172a" }}>
                        ${(ms.amountCents / 100).toFixed(2)} <span style={{ fontSize: 12, fontWeight: 600 }}>CAD</span>
                      </div>
                      <span style={{ fontSize: 11, color: "#64748b" }}>
                        Includes ${(ms.platformFeeCents / 100).toFixed(2)} platform fee
                      </span>
                    </div>

                    {ms.status === "PENDING" ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setSelectedMilestoneForPay(ms);
                          setIsCheckoutModalOpen(true);
                        }}
                      >
                        Authorize & Pay →
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCheckoutFeedback(`Receipt viewed for ${ms.id}. Transaction ${ms.transactionRef} settled via Stripe Direct Transfer.`);
                        }}
                      >
                        📄 View Receipt
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Saved Payment Methods */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Saved Payment Methods
                </h3>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Encrypted & vaulted by Stripe Elements · 256-bit TLS
                </span>
              </div>
              <Badge tone="green">PCI-DSS Level 1</Badge>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {customerPms.map((pm) => (
                <div
                  key={pm.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>💳</span>
                    <div>
                      <strong style={{ fontSize: 14 }}>{pm.brand} ending in {pm.last4}</strong>
                      <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>
                        Expires: {pm.exp}
                      </span>
                    </div>
                  </div>
                  {pm.isDefault && <Badge tone="blue">Default Method</Badge>}
                </div>
              ))}
            </div>
          </Card>

          {/* Ontario Consumer Protection Notice */}
          <Callout tone="info" title="Ontario Consumer Protection & Payment Transparency">
            Skilled Hire operates as a licensed marketplace facilitator in Ontario. Payments are authorized per milestone schedule and deposited directly to verified contractors. No advance funds are withheld under unauthorized escrow terms.
          </Callout>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 8: RELIABLE NOTIFICATIONS & TRANSACTIONAL OUTBOX (SH-09)
         ------------------------------------------------------------- */}
      {activeTab === "preferences" && (
        <div style={{ display: "grid", gap: 24 }}>
          {notifFeedback && (
            <Callout
              tone={notifFeedback.type === "error" ? "danger" : notifFeedback.type === "success" ? "success" : "info"}
              title={notifFeedback.type === "error" ? "Statutory Regulatory Guardrail" : "Communication Settings Updated"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{notifFeedback.message}</span>
                <Button size="sm" variant="quiet" onClick={() => setNotifFeedback(null)}>
                  Dismiss
                </Button>
              </div>
            </Callout>
          )}

          <Grid columns="repeat(auto-fit, minmax(220px, 1fr))">
            <Metric
              label="Outbox Architecture"
              value="Transactional"
              detail="Atomic DB Commit"
            />
            <Metric
              label="Active Channels"
              value="3 Providers"
              detail="Email · SMS · Push"
            />
            <Metric
              label="Delivery Assurance"
              value="99.98%"
              detail="Exponential Backoff"
            />
          </Grid>

          {/* User Notification Preferences Section */}
          <Card tone="white" padding="lg">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, margin: "0 0 4px", color: "#0f172a" }}>
                  Homeowner Communication Channels
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                  Fine-tune how Skilled Hire contacts you regarding arrivals, job milestones, and quotes.
                </p>
              </div>
              <Badge tone="blue">Ontario Consumer Protection Compliant</Badge>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {notificationPreferences.map((pref) => (
                <div
                  key={pref.category}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: pref.isStatutory ? "1.5px solid #bfdbfe" : "1px solid #e2e8f0",
                    background: pref.isStatutory ? "#f8faff" : "#ffffff",
                  }}
                >
                  <div style={{ maxWidth: "55%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 15, color: "#0f172a" }}>{pref.label}</strong>
                      {pref.isStatutory && (
                        <Badge tone="blue">Statutory · Non-Excludable</Badge>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                      {pref.description}
                    </p>
                  </div>

                  {/* Channel Toggles */}
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: pref.isStatutory ? "#94a3b8" : "#334155",
                        cursor: pref.isStatutory ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={pref.emailEnabled}
                        disabled={pref.isStatutory}
                        onChange={() => handleTogglePreference(pref.category, "email")}
                        style={{ accentColor: "#2563eb", cursor: pref.isStatutory ? "not-allowed" : "pointer" }}
                      />
                      Email
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: pref.isStatutory ? "#94a3b8" : "#334155",
                        cursor: pref.isStatutory ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={pref.smsEnabled}
                        disabled={pref.isStatutory}
                        onChange={() => handleTogglePreference(pref.category, "sms")}
                        style={{ accentColor: "#2563eb", cursor: pref.isStatutory ? "not-allowed" : "pointer" }}
                      />
                      SMS
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#334155",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={pref.pushEnabled}
                        onChange={() => handleTogglePreference(pref.category, "push")}
                        style={{ accentColor: "#2563eb", cursor: "pointer" }}
                      />
                      Push
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Customer Outbox History & Sandbox Tests */}
          <Card tone="white" padding="lg">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, margin: "0 0 4px", color: "#0f172a" }}>
                  Live Outbox Delivery Stream
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                  Immutable delivery logs showing atomic transactional dispatch, idempotency hashes, and channel delivery receipts.
                </p>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isSendingTestNotif}
                  onClick={() => handleSendTestNotification("SMS", "DISPATCH_ALERTS")}
                >
                  {isSendingTestNotif ? "Dispatching..." : "Simulate Dispatch SMS"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isSendingTestNotif}
                  onClick={() => handleSendTestNotification("EMAIL", "TRANSACTIONAL_RECEIPTS")}
                >
                  {isSendingTestNotif ? "Dispatching..." : "Simulate Receipt Email"}
                </Button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {customerOutbox.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={msg.channel === "SMS" ? "green" : msg.channel === "EMAIL" ? "blue" : "purple"}>
                        {msg.channel}
                      </Badge>
                      <strong style={{ fontSize: 14, color: "#0f172a" }}>{msg.subject}</strong>
                      <span style={{ fontSize: 12, color: "#64748b" }}>→ {msg.recipient}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{msg.sentAt}</span>
                      <Badge tone={msg.status === "DELIVERED" ? "green" : "amber"}>
                        {msg.status}
                      </Badge>
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: 13, color: "#334155" }}>
                    {msg.preview}
                  </p>

                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                    <span>ID: {msg.id}</span>
                    <span>KEY: {msg.idempotencyKey}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Ontario Statutory Protection Note */}
          <Callout tone="info" title="Ontario Statutory Consumer Protection & Safety Mandates">
            Pursuant to the Ontario Consumer Protection Act and Technical Standards and Safety Act (TSSA), emergency safety alerts (gas leaks, CO detection, freeze risk) and transactional payment proofs cannot be opted out of. Non-statutory alerts (technician arrival SMS, marketing updates) can be freely toggled or unsubscribed from at any time.
          </Callout>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 10: CUSTOMER-TECHNICIAN MESSAGING & MASKED COMMUNICATIONS (SH-14 / #15)
         ------------------------------------------------------------- */}
      {activeTab === "messages" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Top Banner & Quick Controls */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <h2 style={{ fontSize: 22, margin: 0, fontWeight: 800, color: "#0f172a" }}>
                  Job #REQ-2026-9921 Messaging
                </h2>
                <Badge tone={jobMessagingClosed ? "amber" : "green"}>
                  {jobMessagingClosed ? "Communication Window Closed" : "Live Secure Channel"}
                </Badge>
                <Badge tone="blue">Ontario Privacy Protected</Badge>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                Directly connect with Lead HVAC Technician <strong>Marcus Vance</strong>. Personal phone numbers remain masked.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsMaskedBridgeModalOpen(true)}
              >
                📞 Virtual Proxy Bridge & PIN
              </Button>
              <a
                href="tel:+18005557233"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#dc2626",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  textDecoration: "none",
                }}
              >
                🚨 Emergency Safety Desk: +1-800-555-SAFE
              </a>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setJobMessagingClosed((prev) => !prev)}
              >
                {jobMessagingClosed ? "Reopen Window" : "Test Closed Gate"}
              </Button>
            </div>
          </div>

          {/* Privacy & Anti-Circumvention Policy Callout */}
          {moderationAlert ? (
            <Callout
              tone="warning"
              title="Marketplace Safety & Anti-Circumvention Alert"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  Our real-time safety screen flagged off-platform transaction keywords ({moderationAlert.reasons.join(", ")}). Direct cash deals or e-transfers void your 365-day Skilled Hire workmanship guarantee and statutory Ontario consumer protections.
                </span>
                <Button size="sm" variant="quiet" onClick={() => setModerationAlert(null)}>
                  Dismiss
                </Button>
              </div>
            </Callout>
          ) : (
            <div
              style={{
                background: "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)",
                borderRadius: 12,
                padding: "12px 18px",
                border: "1px solid #bfdbfe",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 13,
                color: "#1e3a8a",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🛡️</span>
                <span>
                  <strong>Shielded Communications Active:</strong> All messages and relay calls are encrypted, monitored for fraud and circumvention, and archived for dispute resolution.
                </span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0369a1" }}>
                Your Relay ID: {maskedSessionData.sessionExtension}
              </span>
            </div>
          )}

          {/* Chat Stream & Composer Card */}
          <Card tone="white" padding="lg">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 12,
                borderBottom: "1px solid #e2e8f0",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "#2563eb",
                    color: "#ffffff",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    fontSize: 16,
                  }}
                >
                  MV
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                    Marcus Vance · Lead HVAC Technician (313A)
                  </h3>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                    <span style={{ fontSize: 12, color: "#059669", fontWeight: 700 }}>● Online & En Route</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>· Phone: {maskedSessionData.technicianMaskedPhone}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.senderRole !== "CUSTOMER" && !m.readAt
                          ? { ...m, status: "READ", readAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }
                          : m,
                      ),
                    );
                  }}
                >
                  ✓✓ Mark All Read
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    const techReplies = [
                      "Just pulled up onto King Street, parking the van now.",
                      "I've got the factory OEM Lennox capacitor in hand. Heading to the side gate.",
                      "Diagnostic manifold is hooked up. Secondary pressure readings look stable.",
                    ];
                    const chosen = techReplies[Math.floor(Math.random() * techReplies.length)]!;
                    const newTechMsg = {
                      id: `msg-sim-${Date.now()}`,
                      senderRole: "TECHNICIAN" as const,
                      senderDisplayName: "Marcus Vance",
                      content: chosen,
                      attachmentKeys: [],
                      status: "DELIVERED" as const,
                      moderationStatus: "APPROVED" as const,
                      moderationReason: null,
                      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      deliveredAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      readAt: null,
                    };
                    setMessages((prev) => [...prev, newTechMsg]);
                  }}
                >
                  ⚡ Simulate Tech Reply
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    const flagMsg = {
                      id: `msg-flag-${Date.now()}`,
                      senderRole: "TECHNICIAN" as const,
                      senderDisplayName: "Marcus Vance",
                      content: "Can you send $150 deposit directly via Interac e-transfer to private@tech.test or cash to skip taxes?",
                      attachmentKeys: [],
                      status: "DELIVERED" as const,
                      moderationStatus: "FLAGGED" as const,
                      moderationReason: "OFF_PLATFORM_ETRANSFER_DETECTED, DIRECT_EMAIL_SHARED",
                      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      deliveredAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      readAt: null,
                    };
                    setMessages((prev) => [...prev, flagMsg]);
                    setModerationAlert({
                      status: "FLAGGED",
                      reasons: ["OFF_PLATFORM_ETRANSFER_DETECTED", "DIRECT_EMAIL_SHARED"],
                    });
                  }}
                >
                  ⚠️ Simulate Circumvention Flag
                </Button>
              </div>
            </div>

            {/* Scrollable Message History Stream */}
            <div
              style={{
                minHeight: 320,
                maxHeight: 460,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "8px 4px 16px",
              }}
            >
              {messages.map((m) => {
                const isCustomer = m.senderRole === "CUSTOMER";
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isCustomer ? "flex-end" : "flex-start",
                      maxWidth: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        fontSize: 12,
                        color: "#64748b",
                      }}
                    >
                      <strong style={{ color: isCustomer ? "#2563eb" : "#0f172a" }}>
                        {m.senderDisplayName}
                      </strong>
                      <span>·</span>
                      <span>{m.createdAt}</span>
                      {m.moderationStatus === "FLAGGED" && (
                        <Badge tone="danger">⚠️ Flagged by Safety</Badge>
                      )}
                    </div>

                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "12px 16px",
                        borderRadius: isCustomer ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        background: isCustomer
                          ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
                          : "#f1f5f9",
                        color: isCustomer ? "#ffffff" : "#0f172a",
                        boxShadow: isCustomer
                          ? "0 2px 4px rgba(37,99,235,0.2)"
                          : "0 1px 2px rgba(0,0,0,0.05)",
                        fontSize: 14,
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                        border: m.moderationStatus === "FLAGGED" ? "2px solid #ef4444" : "none",
                      }}
                    >
                      {m.content}

                      {/* Attachments */}
                      {m.attachmentKeys && m.attachmentKeys.length > 0 && (
                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {m.attachmentKeys.map((key, i) => (
                            <div
                              key={i}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 8px",
                                borderRadius: 6,
                                background: isCustomer ? "rgba(255,255,255,0.2)" : "#e2e8f0",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              📷 Attachment #{i + 1} ({key.split("/").pop()})
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Delivery & Read Receipts */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                        fontSize: 11,
                        color: "#94a3b8",
                      }}
                    >
                      {isCustomer ? (
                        m.readAt ? (
                          <span style={{ color: "#2563eb", fontWeight: 700 }}>
                            ✓✓ Read {m.readAt}
                          </span>
                        ) : m.deliveredAt ? (
                          <span>✓✓ Delivered</span>
                        ) : (
                          <span>✓ Sent</span>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Prompt Suggestion Chips */}
            {!jobMessagingClosed && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  overflowX: "auto",
                  padding: "10px 0",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                {[
                  "Side gate code is #4819",
                  "Please ring front bell upon arrival",
                  "Dog is secured in the garage",
                  "Can I see the old damaged part before disposal?",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setMessageInput(chip)}
                    style={{
                      whiteSpace: "nowrap",
                      padding: "6px 12px",
                      borderRadius: 16,
                      background: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      fontSize: 12,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    💬 {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Composer Box */}
            {jobMessagingClosed ? (
              <div
                style={{
                  background: "#fffbeb",
                  borderRadius: 12,
                  padding: 16,
                  border: "1px solid #fde68a",
                  textAlign: "center",
                  color: "#92400e",
                  fontSize: 13,
                }}
              >
                🔒 <strong>Messaging is closed</strong> for this job because the appointment was completed or cancelled. For follow-up warranty claims, please consult the Warranty & Passport tab or contact customer support.
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!messageInput.trim()) return;
                  const screening = screenMessageContent(messageInput);
                  if (screening.status === "FLAGGED") {
                    setModerationAlert({
                      status: "FLAGGED",
                      reasons: screening.reasons,
                    });
                  }
                  const newMsg = {
                    id: `msg-${Date.now()}`,
                    senderRole: "CUSTOMER" as const,
                    senderDisplayName: "Sarah Jenkins",
                    content: messageInput.trim(),
                    attachmentKeys: messageAttachments,
                    status: "DELIVERED" as const,
                    moderationStatus: screening.status,
                    moderationReason: screening.reasons.length > 0 ? screening.reasons.join(", ") : null,
                    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    deliveredAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    readAt: null,
                  };
                  setMessages((prev) => [...prev, newMsg]);
                  setMessageInput("");
                  setMessageAttachments([]);
                }}
                style={{ display: "grid", gap: 10, marginTop: 8 }}
              >
                <div style={{ position: "relative" }}>
                  <textarea
                    rows={3}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type an arrival note or question for Marcus Vance (e.g. parking instructions, pet notes, gate code)..."
                    maxLength={4000}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      borderRadius: 12,
                      border: "1.5px solid #cbd5e1",
                      padding: "12px 14px",
                      fontSize: 14,
                      lineHeight: 1.5,
                      fontFamily: "inherit",
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 8,
                      right: 12,
                      fontSize: 11,
                      color: messageInput.length > 3800 ? "#ef4444" : "#94a3b8",
                    }}
                  >
                    {messageInput.length} / 4000
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const sampleKeys = [
                          "uploads/messaging/thermostat-screen.jpg",
                          "uploads/messaging/side-gate-entrance.jpg",
                          "uploads/messaging/furnace-label.jpg",
                        ];
                        const randomKey = sampleKeys[messageAttachments.length % sampleKeys.length]!;
                        if (messageAttachments.length < 5) {
                          setMessageAttachments((prev) => [...prev, randomKey]);
                        } else {
                          alert("Maximum 5 attachments allowed per message");
                        }
                      }}
                    >
                      📎 Attach Photo Evidence ({messageAttachments.length}/5)
                    </Button>

                    {messageAttachments.length > 0 && (
                      <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>
                        {messageAttachments.length} file(s) attached
                      </span>
                    )}
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!messageInput.trim()}
                  >
                    Send Message ✉️
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      {/* Checkout / Milestone Pay Modal */}
      <Modal
        isOpen={isCheckoutModalOpen && selectedMilestoneForPay !== null}
        onClose={() => {
          setIsCheckoutModalOpen(false);
          setSelectedMilestoneForPay(null);
        }}
        title="Authorize Milestone Payment via Stripe"
      >
        {selectedMilestoneForPay && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ background: "#f8fafc", padding: 14, borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 2 }}>
                Milestone Description
              </span>
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                {selectedMilestoneForPay.title}
              </strong>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 13, color: "#475569" }}>Total Locked Amount (Server-side):</span>
                <strong style={{ fontSize: 18, color: "#0f172a" }}>
                  ${(selectedMilestoneForPay.amountCents / 100).toFixed(2)} CAD
                </strong>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                Payment Method
              </label>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>💳 Visa ending in 4242 (Vaulted)</span>
                <Badge tone="green">Active</Badge>
              </div>
            </div>

            {/* Sandbox Simulation Options */}
            <div style={{ background: "#f1f5f9", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                🧪 Stripe Sandbox Simulation Controls:
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="testOutcome"
                    checked={testOutcome === "success"}
                    onChange={() => setTestOutcome("success")}
                  />
                  ✓ Success
                </label>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="testOutcome"
                    checked={testOutcome === "card_declined"}
                    onChange={() => setTestOutcome("card_declined")}
                  />
                  ❌ Card Declined
                </label>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="testOutcome"
                    checked={testOutcome === "requires_action"}
                    onChange={() => setTestOutcome("requires_action")}
                  />
                  🔐 3DS / SCA
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsCheckoutModalOpen(false);
                  setSelectedMilestoneForPay(null);
                }}
                disabled={checkoutProcessing}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmMilestonePayment}
                disabled={checkoutProcessing}
              >
                {checkoutProcessing ? "Processing via Stripe..." : `Confirm Payment ($${(selectedMilestoneForPay.amountCents / 100).toFixed(2)} CAD)`}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Accept Service Recommendation Modal */}
      <Modal
        isOpen={isAcceptModalOpen && selectedRecForAction !== null}
        onClose={() => {
          setIsAcceptModalOpen(false);
          setSelectedRecForAction(null);
        }}
        title="Approve & Authorize Discovered Service"
      >
        {selectedRecForAction && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ background: "#f0fdf4", padding: 14, borderRadius: 12, border: "1px solid #bbf7d0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <strong style={{ fontSize: 16, color: "#14532d" }}>
                  {selectedRecForAction.title}
                </strong>
                <span style={{ fontSize: 18, fontWeight: 900, color: "#15803d" }}>
                  ${(selectedRecForAction.estimatedCostCents / 100).toFixed(2)} CAD
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#166534" }}>
                Price is guaranteed fixed-price and includes all certified parts, specialized tools, and technician labour.
              </p>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                Execution Timing
              </label>
              <div style={{ display: "grid", gap: 10 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1.5px solid ${convertImmediately ? "#2563eb" : "#cbd5e1"}`,
                    background: convertImmediately ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="timing"
                    checked={convertImmediately}
                    onChange={() => setConvertImmediately(true)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <strong style={{ fontSize: 14, color: "#0f172a" }}>
                      Install during today&apos;s visit (Recommended)
                    </strong>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#475569" }}>
                      Technician Marcus is currently on site with parts available. Adds approx. 25–35 minutes to today&apos;s job.
                    </p>
                  </div>
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1.5px solid ${!convertImmediately ? "#2563eb" : "#cbd5e1"}`,
                    background: !convertImmediately ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="timing"
                    checked={!convertImmediately}
                    onChange={() => setConvertImmediately(false)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <strong style={{ fontSize: 14, color: "#0f172a" }}>
                      Schedule as a follow-up appointment
                    </strong>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#475569" }}>
                      Reserve and lock in this rate; our operations team will coordinate an upcoming date and time window with you.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsAcceptModalOpen(false);
                  setSelectedRecForAction(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmAccept}>
                Confirm & Authorize (${(selectedRecForAction.estimatedCostCents / 100).toFixed(2)} CAD)
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Decline Service Recommendation Modal */}
      <Modal
        isOpen={isDeclineModalOpen && selectedRecForAction !== null}
        onClose={() => {
          setIsDeclineModalOpen(false);
          setSelectedRecForAction(null);
        }}
        title="Decline Recommended Service"
      >
        {selectedRecForAction && (
          <div style={{ display: "grid", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
              Declining this service recommendation is completely your choice. Your response will be recorded in your Property Service Passport so you and future technicians have a clear record.
            </p>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                Please tell us the reason for declining:
              </label>
              <select
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value as RecommendationDeclineReason)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              >
                <option value="TOO_EXPENSIVE">Cost exceeds current budget / too expensive</option>
                <option value="WILL_DO_LATER">Will address at a later date / post-season</option>
                <option value="DIY_OR_OWN_CONTRACTOR">Will perform myself or have personal contractor</option>
                <option value="NOT_NEEDED">Do not believe this repair is necessary right now</option>
                <option value="SELLING_HOME">Planning to sell / move home soon</option>
                <option value="OTHER">Other reason</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                Additional Notes or Feedback (Optional)
              </label>
              <textarea
                value={declineNotes}
                onChange={(e) => setDeclineNotes(e.target.value)}
                placeholder="Any details to help technician or keep in your property record..."
                style={{
                  width: "100%",
                  minHeight: 70,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsDeclineModalOpen(false);
                  setSelectedRecForAction(null);
                }}
              >
                Keep Reviewing
              </Button>
              <Button variant="danger" onClick={handleConfirmDecline}>
                Submit Decline Response
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Discovered Service Evidence & Full Response Audit Trail Modal */}
      <Modal
        isOpen={selectedRecForDetail !== null}
        onClose={() => setSelectedRecForDetail(null)}
        title="Discovered Service Evidence & Response Audit Trail"
      >
        {selectedRecForDetail && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ background: "#f8fafc", padding: 14, borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <strong style={{ fontSize: 16, color: "#0f172a" }}>{selectedRecForDetail.title}</strong>
                    <Badge
                      tone={
                        selectedRecForDetail.urgency === "IMMEDIATE_SAFETY_HAZARD"
                          ? "danger"
                          : selectedRecForDetail.urgency === "URGENT_REPAIR"
                            ? "amber"
                            : selectedRecForDetail.urgency === "RECOMMENDED_MAINTENANCE"
                              ? "blue"
                              : "green"
                      }
                    >
                      {selectedRecForDetail.urgency.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                    Job: {selectedRecForDetail.jobId} · Property: {selectedRecForDetail.propertyAddress ?? "123 King St W, Toronto"}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>
                    ${(selectedRecForDetail.estimatedCostCents / 100).toFixed(2)} CAD
                  </span>
                </div>
              </div>

              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#334155", lineHeight: 1.4 }}>
                {selectedRecForDetail.description}
              </p>
            </div>

            {/* Evidence photos */}
            {selectedRecForDetail.evidencePhotos && selectedRecForDetail.evidencePhotos.length > 0 && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>
                  Photographic Evidence Captured On-Site
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {selectedRecForDetail.evidencePhotos.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt="Inspection discovery evidence"
                      style={{
                        width: 140,
                        height: 95,
                        objectFit: "cover",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Response Audit Trail Timeline */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                Chronological Response History & Decision Audit Log
              </label>
              <div style={{ display: "grid", gap: 10 }}>
                {(selectedRecForDetail.responses ?? []).map((resp, i) => (
                  <div
                    key={resp.id || i}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      borderRadius: 10,
                      background:
                        resp.action === "ACCEPTED" || resp.action === "CONVERTED"
                          ? "#f0fdf4"
                          : resp.action === "DECLINED"
                            ? "#fef2f2"
                            : resp.action === "DEFERRED"
                              ? "#fffbeb"
                              : "#f8fafc",
                      border:
                        resp.action === "ACCEPTED" || resp.action === "CONVERTED"
                          ? "1px solid #bbf7d0"
                          : resp.action === "DECLINED"
                            ? "1px solid #fecaca"
                            : resp.action === "DEFERRED"
                              ? "1px solid #fde68a"
                              : "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 16 }}>
                      {resp.action === "PROPOSED"
                        ? "💡"
                        : resp.action === "ACCEPTED"
                          ? "✓"
                          : resp.action === "DECLINED"
                            ? "✕"
                            : resp.action === "DEFERRED"
                              ? "⏱"
                              : "🔄"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: 13, color: "#0f172a" }}>
                          {resp.action === "PROPOSED"
                            ? "Technician Proposed Recommendation"
                            : resp.action === "ACCEPTED"
                              ? "Homeowner Accepted Service"
                              : resp.action === "DECLINED"
                                ? "Homeowner Declined Service"
                                : resp.action === "DEFERRED"
                                  ? "Homeowner Deferred Decision"
                                  : "Converted to Follow-up Service Request"}
                        </strong>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {new Date(resp.createdAt).toLocaleDateString("en-CA", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
                        Actor: {resp.actorRole} ({resp.actorId})
                      </p>
                      {resp.notes && (
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#334155" }}>
                          &ldquo;{resp.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              {selectedRecForDetail.status === "PROPOSED" && (
                <>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const rec = selectedRecForDetail;
                      setSelectedRecForDetail(null);
                      handleOpenAcceptModal(rec);
                    }}
                  >
                    ✓ Accept Service
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const rec = selectedRecForDetail;
                      setSelectedRecForDetail(null);
                      handleOpenDeclineModal(rec);
                    }}
                  >
                    ✕ Decline Service
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setSelectedRecForDetail(null)}>
                Close Audit View
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Appointment & Policy Quote Modal */}
      <Modal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        title="Cancel Appointment & Policy Fee Quote"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            Under Ontario home services regulations, cancellations submitted more than 2 hours prior to scheduled dispatch incur zero penalty. Review your quote below before confirming.
          </p>

          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#334155",
                display: "block",
                marginBottom: 6,
              }}
            >
              Reason for Cancellation
            </label>
            <select
              value={cancelReason}
              onChange={(e) =>
                setCancelReason(e.target.value as CancellationReason)
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 14,
                background: "#fff",
              }}
            >
              <option value="CUSTOMER_SCHEDULE_CONFLICT">
                Customer Schedule Conflict / Personal Emergency
              </option>
              <option value="CUSTOMER_NO_LONGER_NEEDED">
                Problem Resolved by Self / No Longer Needed
              </option>
              <option value="CUSTOMER_ACCIDENTAL_BOOKING">
                Accidental or Duplicate Booking
              </option>
              <option value="CUSTOMER_PRICE_DISSATISFACTION">
                Price Dissatisfaction / Found Alternative
              </option>
              <option value="SEVERE_WEATHER_HAZARD">
                Severe Winter Weather / Force Majeure Conditions
              </option>
              <option value="TECHNICIAN_NO_SHOW">
                Technician Arrival Delayed / SLA Window Missed
              </option>
              <option value="OTHER">
                Other Reason / Property Safety Concern
              </option>
            </select>
          </div>

          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#334155",
                display: "block",
                marginBottom: 6,
              }}
            >
              Additional Notes (Optional)
            </label>
            <textarea
              value={cancelNotes}
              onChange={(e) => setCancelNotes(e.target.value)}
              placeholder="Tell us what changed or how we can assist..."
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Real-time Policy Quote Breakdown */}
          <div
            style={{
              background: "#f8fafc",
              padding: 14,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
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
              <strong style={{ fontSize: 14, color: "#0f172a" }}>
                Ontario Policy Calculation
              </strong>
              <Badge
                tone={
                  cancelQuote.cancellationFeeCents === 0 ? "green" : "amber"
                }
              >
                {cancelQuote.policyApplied.replace(/_/g, " ")}
              </Badge>
            </div>

            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Paid Initial Fee:</span>
                <span style={{ fontWeight: 600 }}>$89.00 CAD</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Cancellation Fee:</span>
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      cancelQuote.cancellationFeeCents === 0
                        ? "#059669"
                        : "#dc2626",
                  }}
                >
                  ${(cancelQuote.cancellationFeeCents / 100).toFixed(2)} CAD
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                <strong style={{ color: "#0f172a" }}>
                  Net Refund to Card:
                </strong>
                <strong style={{ fontSize: 16, color: "#059669" }}>
                  ${(cancelQuote.refundAmountCents / 100).toFixed(2)} CAD
                </strong>
              </div>
            </div>

            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                color: "#475569",
                lineHeight: 1.4,
              }}
            >
              {cancelQuote.explanation}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 6,
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setIsCancelModalOpen(false)}
            >
              Keep Appointment
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmCancellation}
            >
              Confirm Cancellation & Refund
            </Button>
          </div>
        </div>
      </Modal>

      {/* Report Delay / No-Show Modal */}
      <Modal
        isOpen={isNoShowModalOpen}
        onClose={() => setIsNoShowModalOpen(false)}
        title="Report Technician Delay or No-Show"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            Under the <strong>Skilled Hire On-Time Guarantee</strong>, if your technician is more than 30 minutes past their arrival window without prior communication, you receive an immediate $25.00 courtesy credit and priority recovery options.
          </p>

          <div
            style={{
              background: "#ecfdf5",
              border: "1px solid #bbf7d0",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🛡️</span>
              <strong style={{ fontSize: 13, color: "#065f46" }}>
                Ontario Service Quality Guarantee
              </strong>
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "#047857",
              }}
            >
              Submitting this report immediately issues a <strong>$25.00 courtesy credit</strong> to your wallet, logs a performance strike for the contractor, and offers you instant standby reassignment or 100% full refund.
            </p>
          </div>

          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#334155",
                display: "block",
                marginBottom: 6,
              }}
            >
              Notes for Operations Dispatch (Optional)
            </label>
            <textarea
              value={noShowNotes}
              onChange={(e) => setNoShowNotes(e.target.value)}
              placeholder="e.g. Technician was expected at 11:00 AM. Called at 11:35 AM with no response."
              rows={3}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 6,
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setIsNoShowModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={isReportingNoShow}
              onClick={handleConfirmReportNoShow}
            >
              {isReportingNoShow
                ? "Submitting Report..."
                : "Submit No-Show Report"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Customer Recovery Choice Modal */}
      <Modal
        isOpen={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
        title="Ontario Dispatch Guarantee: Choose Recovery Option"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#1e40af",
                fontWeight: 600,
              }}
            >
              🎁 A $25.00 courtesy credit has been credited to your Skilled Hire wallet. Please select how you would like to proceed with today&apos;s service request:
            </p>
          </div>

          {/* Option 1: Standby Reassignment */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: "1.5px solid #2563eb",
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                1. Accept Standby Certified Specialist
              </strong>
              <Badge tone="green">Fastest (20m ETA)</Badge>
            </div>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 13,
                color: "#475569",
              }}
            >
              <strong>Liam Vance</strong> (TSSA Gas G1 #771890 · 313A Refrigeration Mechanic) from Apex Climate Pro is available nearby and can arrive within 20 minutes.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleRecoveryChoice("ACCEPT_REASSIGNMENT")}
            >
              ✓ Accept Standby Specialist
            </Button>
          </div>

          {/* Option 2: Reschedule Priority Slot */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                2. Reschedule to Priority Slot
              </strong>
              <Badge tone="blue">Tomorrow 9:00 AM</Badge>
            </div>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 13,
                color: "#475569",
              }}
            >
              Move your diagnostic visit to tomorrow morning (9:00 AM – 11:00 AM) with first-in-queue VIP priority dispatch.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleRecoveryChoice("RESCHEDULE_NEW_SLOT")}
            >
              📅 Reschedule Appointment
            </Button>
          </div>

          {/* Option 3: Full Refund */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                3. Cancel for 100% Full Refund
              </strong>
              <Badge tone="neutral">100% Refund</Badge>
            </div>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 13,
                color: "#475569",
              }}
            >
              Cancel this request with an immediate 100% refund of $89.00 CAD to your Stripe payment method. Keep your $25 courtesy credit for future services.
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleRecoveryChoice("FULL_REFUND_CANCEL")}
            >
              ✕ Cancel for Full Refund
            </Button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setIsRecoveryModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* -------------------------------------------------------------
          MODAL: BOOKING SUBMISSION RECEIPT (SH-11)
         ------------------------------------------------------------- */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => {
          setIsReceiptModalOpen(false);
          setActiveTab("tracking");
        }}
        title="Official Service Booking Receipt"
      >
        {confirmedReceipt && (
          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
                border: "1.5px solid #86efac",
                borderRadius: 16,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "#16a34a",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 17, color: "#166534" }}>
                    Service Request Confirmed & Dispatched
                  </strong>
                  <Badge tone="green">STATUS: CONFIRMED</Badge>
                </div>
                <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>
                  Booking Reference: <strong>{confirmedReceipt.referenceNumber}</strong> · Request ID:{" "}
                  {confirmedReceipt.serviceRequestId}
                </div>
              </div>
            </div>

            {/* Two column grid of details */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Customer & Property
                </div>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                  {confirmedReceipt.customerName}
                </div>
                <div style={{ fontSize: 13, color: "#334155", marginTop: 2 }}>
                  {confirmedReceipt.propertyLabel}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {confirmedReceipt.propertyAddress}
                </div>
                {confirmedReceipt.customerPhone && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Phone: {confirmedReceipt.customerPhone}
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Service Appointment & Window
                </div>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                  {confirmedReceipt.tradeName} Diagnostic
                </div>
                <div style={{ fontSize: 13, color: "#334155", marginTop: 2 }}>
                  📅 {confirmedReceipt.scheduledStart ?? "Today, 1:00 PM"}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Urgency: {confirmedReceipt.urgency === "EMERGENCY" ? "⚡ Emergency (~45m SLA)" : "Standard Scheduled"}
                </div>
                {confirmedReceipt.equipmentSummary && (
                  <div style={{ fontSize: 11, color: "#1e40af", marginTop: 4, fontWeight: 600 }}>
                    Asset: {confirmedReceipt.equipmentSummary}
                  </div>
                )}
              </div>
            </div>

            {/* Financial & Fee Summary */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #cbd5e1",
                borderRadius: 14,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 8 }}>
                Authorized Fee Breakdown (Diagnostic Call-Out)
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>Diagnostic Truck Roll & Initial Assessment:</span>
                <strong>${(confirmedReceipt.basePriceCents / 100).toFixed(2)} CAD</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>Workmanship Guarantee Protection Cap:</span>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>$25,000.00 Included</span>
              </div>
              {confirmedReceipt.protectionCoverageCents > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>Incidental Damage Protection Insurance:</span>
                  <span>$19.00 CAD (Authorized)</span>
                </div>
              )}
              <Divider />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, marginTop: 4 }}>
                <span>Total Authorized at Dispatch:</span>
                <span>${((confirmedReceipt.basePriceCents + (confirmedReceipt.protectionCoverageCents > 0 ? 1900 : 0)) / 100).toFixed(2)} CAD</span>
              </div>
            </div>

            {/* Ontario Statutory Protections & Disclosures */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                padding: 14,
                fontSize: 12,
                color: "#475569",
              }}
            >
              <strong style={{ color: "#0f172a", display: "block", marginBottom: 6 }}>
                Ontario Statutory Compliance Disclosures
              </strong>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                {confirmedReceipt.statutoryDisclosures.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              <div style={{ marginTop: 8, color: "#166534", fontWeight: 600 }}>
                {confirmedReceipt.guaranteeSummary}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  window.print();
                }}
              >
                🖨️ Print / Save PDF
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setIsReceiptModalOpen(false);
                  setActiveTab("tracking");
                }}
              >
                Track Live Technician →
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* -------------------------------------------------------------
          MODAL: ADD PROPERTY (SH-11)
         ------------------------------------------------------------- */}
      <Modal
        isOpen={isAddPropertyModalOpen}
        onClose={() => setIsAddPropertyModalOpen(false)}
        title="Add Service Property"
      >
        <div style={{ display: "grid", gap: 14 }}>
          <Field
            label="Property Label"
            placeholder="e.g. Primary Residence, Muskoka Cottage, Downtown Rental"
            value={newPropLabel}
            onChange={setNewPropLabel}
          />
          <Field
            label="Street Address"
            placeholder="e.g. 789 Bay Street"
            value={newPropAddress}
            onChange={setNewPropAddress}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field
              label="Unit / Suite (Optional)"
              placeholder="e.g. Unit 402"
              value={newPropUnit}
              onChange={setNewPropUnit}
            />
            <Field
              label="City"
              placeholder="e.g. Toronto"
              value={newPropCity}
              onChange={setNewPropCity}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field
              label="Postal Code (Ontario A1A 1A1)"
              placeholder="e.g. M5J 2R8"
              value={newPropPostalCode}
              onChange={(val) => setNewPropPostalCode(val.toUpperCase())}
            />
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                Property Type
              </label>
              <select
                aria-label="New property type"
                value={newPropType}
                onChange={(e) => setNewPropType(e.target.value as PropertyType)}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                <option value="DETACHED">Detached House</option>
                <option value="SEMI_DETACHED">Semi-Detached</option>
                <option value="TOWNHOUSE">Townhouse</option>
                <option value="CONDO">Condominium / Apartment</option>
                <option value="COMMERCIAL">Commercial / Retail</option>
              </select>
            </div>
          </div>
          <Field
            label="Access & Gate Instructions"
            multiline
            placeholder="Keypad code, lockbox location, concierge buzzer, parking instructions..."
            value={newPropAccessNotes}
            onChange={setNewPropAccessNotes}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={newPropIsPrimary}
              onChange={(e) => setNewPropIsPrimary(e.target.checked)}
            />
            <span>Set this property as my Primary Residence</span>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setIsAddPropertyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newPropAddress.trim() || !newPropPostalCode.trim()}
              onClick={() => {
                const newId = `prop-custom-${Date.now()}`;
                const formattedPostal = newPropPostalCode.trim().replace(/^([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)$/, "$1 $2");
                const newProperty: CustomerPropertyDTO = {
                  id: newId,
                  customerId: customerProfile.id,
                  label: newPropLabel.trim() || newPropAddress.trim(),
                  addressLine1: newPropAddress.trim(),
                  unitNumber: newPropUnit.trim() || undefined,
                  city: newPropCity.trim() || "Toronto",
                  region: "ON",
                  postalCode: formattedPostal,
                  propertyType: newPropType,
                  accessNotes: newPropAccessNotes.trim() || undefined,
                  isPrimary: newPropIsPrimary,
                  equipmentCount: 0,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };

                setProperties((prev) => {
                  const updated = newPropIsPrimary ? prev.map((p) => ({ ...p, isPrimary: false })) : [...prev];
                  return [newProperty, ...updated];
                });

                setSelectedPropertyId(newId);
                setPostalCode(formattedPostal);
                setCustomerProfile((prev) => ({
                  ...prev,
                  propertiesCount: prev.propertiesCount + 1,
                }));

                // Reset modal form
                setNewPropLabel("");
                setNewPropAddress("");
                setNewPropUnit("");
                setNewPropPostalCode("");
                setNewPropAccessNotes("");
                setNewPropIsPrimary(false);
                setIsAddPropertyModalOpen(false);
              }}
            >
              Save Property
            </Button>
          </div>
        </div>
      </Modal>

      {/* -------------------------------------------------------------
          MODAL: CUSTOMER PROFILE & ACCOUNT (SH-11)
         ------------------------------------------------------------- */}
      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        title="Customer Profile & Account"
      >
        <div style={{ display: "grid", gap: 16 }}>
          {/* Stats Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 14,
              padding: 12,
              textAlign: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                {customerProfile.propertiesCount}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Properties</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                {customerProfile.activeServiceRequestsCount}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Active Jobs</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                {customerProfile.completedJobsCount}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Completed</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#16a34a" }}>
                ${(customerProfile.courtesyCreditBalanceCents / 100).toFixed(0)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Credit Balance</div>
            </div>
          </div>

          <Field
            label="Full Legal Name"
            value={editProfileName}
            onChange={setEditProfileName}
          />
          <Field
            label="Phone Number (SMS Notifications)"
            value={editProfilePhone}
            onChange={setEditProfilePhone}
          />
          <Field
            label="Email Address"
            value={customerProfile.email}
            onChange={() => {}}
            hint="Email cannot be changed directly in demo mode."
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 12,
            }}
          >
            <div>
              <strong style={{ fontSize: 13, color: "#166534" }}>Multi-Factor Authentication (MFA)</strong>
              <div style={{ fontSize: 12, color: "#15803d" }}>TOTP Authenticator App Active</div>
            </div>
            <Badge tone="green">Protected</Badge>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="secondary" onClick={() => setIsProfileModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setCustomerProfile((prev) => ({
                  ...prev,
                  fullName: editProfileName.trim() || prev.fullName,
                  phoneNumber: editProfilePhone.trim() || prev.phoneNumber,
                }));
                setIsProfileModalOpen(false);
              }}
            >
              Save Profile
            </Button>
          </div>
        </div>
      </Modal>

      {/* -------------------------------------------------------------
          MODAL: ADD EQUIPMENT ASSET (SH-11)
         ------------------------------------------------------------- */}
      <Modal
        isOpen={isAddEquipmentModalOpen}
        onClose={() => setIsAddEquipmentModalOpen(false)}
        title="Add Equipment to Property Passport"
      >
        <div style={{ display: "grid", gap: 14 }}>
          <Field
            label="Equipment / System Name"
            placeholder="e.g. Lennox Signature XC21 Central AC, Carrier Furnace"
            value={newEqName}
            onChange={setNewEqName}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
                Asset Category
              </label>
              <select
                aria-label="Equipment asset category"
                value={newEqAssetType}
                onChange={(e) => setNewEqAssetType(e.target.value)}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                <option value="AIR_CONDITIONER">Air Conditioner</option>
                <option value="FURNACE">Gas Furnace</option>
                <option value="HEAT_PUMP">Heat Pump</option>
                <option value="BOILER">Boiler / Hydronic</option>
                <option value="WATER_HEATER">Water Heater</option>
                <option value="ELECTRICAL_PANEL">Electrical Panel</option>
                <option value="HRV_ERV">HRV / ERV Air Exchanger</option>
              </select>
            </div>
            <Field
              label="Manufacturer"
              placeholder="e.g. Lennox, Carrier, Trane"
              value={newEqManufacturer}
              onChange={setNewEqManufacturer}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field
              label="Model Number"
              placeholder="e.g. XC21-036-230"
              value={newEqModelNumber}
              onChange={setNewEqModelNumber}
            />
            <Field
              label="Serial Number"
              placeholder="e.g. 5821-LEN-2021"
              value={newEqSerialNumber}
              onChange={setNewEqSerialNumber}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              Warranty Status
            </label>
            <select
              aria-label="Equipment warranty status"
              value={newEqWarranty}
              onChange={(e) =>
                setNewEqWarranty(
                  e.target.value as "ACTIVE" | "EXPIRED" | "UNKNOWN" | "EXTENDED",
                )
              }
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                background: "#fff",
              }}
            >
              <option value="ACTIVE">Active Manufacturer Warranty</option>
              <option value="EXTENDED">Extended 10-Year Labor / Parts</option>
              <option value="EXPIRED">Expired</option>
              <option value="UNKNOWN">Unknown / To Be Verified</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setIsAddEquipmentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newEqName.trim()}
              onClick={() => {
                const newId = `eq-cust-${Date.now()}`;
                const newAsset: EquipmentItem = {
                  id: newId,
                  verticalId: "vert-hvac",
                  name: newEqName.trim(),
                  assetType: newEqAssetType,
                  manufacturer: newEqManufacturer.trim() || undefined,
                  modelNumber: newEqModelNumber.trim() || undefined,
                  serialNumber: newEqSerialNumber.trim() || undefined,
                  warrantyStatus: newEqWarranty,
                  installedOn: new Date().toISOString().split("T")[0],
                };

                setPropertyEquipmentMap((prev) => ({
                  ...prev,
                  [selectedPropertyId]: [...(prev[selectedPropertyId] ?? []), newAsset],
                }));

                setSelectedEquipmentId(newId);
                setNewEqName("");
                setNewEqManufacturer("");
                setNewEqModelNumber("");
                setNewEqSerialNumber("");
                setIsAddEquipmentModalOpen(false);
              }}
            >
              Add Equipment Asset
            </Button>
          </div>
        </div>
      </Modal>

      {/* Decline Quote Modal (SH-12) */}
      <Modal
        isOpen={isDeclineQuoteModalOpen}
        onClose={() => setIsDeclineQuoteModalOpen(false)}
        title="Decline Itemized Quote"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
            You are choosing to decline Quote #{activeQuote.id} (${(activeQuote.customerTotalCents / 100).toFixed(2)} CAD). 
            Please let us know your reason so we can improve and notify technician Marcus Vance.
          </p>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
              Primary Reason for Declining
            </label>
            <select
              value={quoteDeclineReason}
              onChange={(e) =>
                setQuoteDeclineReason(
                  e.target.value as
                    | "PRICE_TOO_HIGH"
                    | "SCOPE_MISMATCH"
                    | "FOUND_ALTERNATIVE"
                    | "DEFER_WORK"
                    | "OTHER",
                )
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 14,
                background: "#ffffff",
              }}
            >
              <option value="PRICE_TOO_HIGH">Overall cost or diagnostic fee exceeds budget</option>
              <option value="SCOPE_MISMATCH">Proposed repairs differ from what I expected</option>
              <option value="FOUND_ALTERNATIVE">Selected an alternative contractor or provider</option>
              <option value="DEFER_WORK">Decided to postpone repairs to a later date</option>
              <option value="OTHER">Other reasons</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
              Additional Notes (Optional)
            </label>
            <span style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>
              Shared with technician Marcus Vance
            </span>
            <textarea
              rows={3}
              value={quoteDeclineNotes}
              onChange={(e) => setQuoteDeclineNotes(e.target.value)}
              placeholder="e.g. Seeking second opinion on compressor electrical draw..."
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              color: "#92400e",
            }}
          >
            ⚠️ <strong>Billing Notice:</strong> Declining the quote closes the repair scope. 
            No repair charges will be applied. Only the initial diagnostic call-out fee will be billed in accordance with the dispatch policy.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsDeclineQuoteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                const fullReason = `${quoteDeclineReason}${quoteDeclineNotes ? `: ${quoteDeclineNotes}` : ""}`;
                setActiveQuote((prev) => ({
                  ...prev,
                  status: "REJECTED",
                  declineReason: fullReason,
                  declinedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                }));
                setIsDeclineQuoteModalOpen(false);
                setQuoteFeedbackBanner({
                  tone: "danger",
                  title: "Quote Declined",
                  message: `Quote #${activeQuote.id} declined. Reason: ${quoteDeclineReason}. Job status updated to QUOTE_REJECTED.`,
                });
              }}
            >
              Confirm Decline
            </Button>
          </div>
        </div>
      </Modal>

      {/* Decline Change Order Modal (SH-12) */}
      <Modal
        isOpen={isDeclineCoModalOpen}
        onClose={() => setIsDeclineCoModalOpen(false)}
        title="Decline Change Order Scope Adjustment"
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
            Declining this scope adjustment (+${(activeChangeOrder.totalCents / 100).toFixed(2)} CAD) instructs Marcus Vance to continue only with the originally approved repair.
          </p>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
              Decline Reason
            </label>
            <select
              value={coDeclineReason}
              onChange={(e) =>
                setCoDeclineReason(
                  e.target.value as "DEFER_WORK" | "DISAGREE_WITH_SCOPE" | "PRICE_TOO_HIGH" | "OTHER",
                )
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 14,
                background: "#ffffff",
              }}
            >
              <option value="DEFER_WORK">Defer this repair to next seasonal maintenance</option>
              <option value="DISAGREE_WITH_SCOPE">Disagree with proposed condensate line replacement</option>
              <option value="PRICE_TOO_HIGH">Cost exceeds current emergency budget</option>
              <option value="OTHER">Other reason</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
              Notes to Technician (Optional)
            </label>
            <textarea
              rows={2}
              value={coDeclineNotes}
              onChange={(e) => setCoDeclineNotes(e.target.value)}
              placeholder="e.g. Please proceed only with capacitor and thermostat wiring..."
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsDeclineCoModalOpen(false)}
            >
              Back
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                const full = `${coDeclineReason}${coDeclineNotes ? `: ${coDeclineNotes}` : ""}`;
                setActiveChangeOrder((prev) => ({
                  ...prev,
                  status: "DECLINED",
                  declineReason: full,
                }));
                setIsDeclineCoModalOpen(false);
                setQuoteFeedbackBanner({
                  tone: "warning",
                  title: "Change Order Declined",
                  message: `Change order declined. Marcus Vance will maintain original scope. No additional fees charged.`,
                });
              }}
            >
              Decline Change Order
            </Button>
          </div>
        </div>
      </Modal>

      {/* Discovery Photo Preview Modal (SH-12) */}
      <Modal
        isOpen={Boolean(selectedPhotoForPreview)}
        onClose={() => setSelectedPhotoForPreview(null)}
        title="Photographic Discovery Evidence"
      >
        {selectedPhotoForPreview && (
          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                width: "100%",
                height: 340,
                backgroundImage: `url(${selectedPhotoForPreview.url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderRadius: 12,
              }}
            />
            <div>
              <h4 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                {selectedPhotoForPreview.caption}
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                {selectedPhotoForPreview.metadata}
              </p>
            </div>
            <div
              style={{
                background: "#f1f5f9",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "#334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>🔒 Cryptographic Sha-256 Verified On-Site Asset</span>
              <span style={{ fontWeight: 700 }}>Inspector: Marcus Vance (313A)</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Masked Contact Bridge & Virtual Relay Modal (SH-14 / #15) */}
      <Modal
        isOpen={isMaskedBridgeModalOpen}
        onClose={() => setIsMaskedBridgeModalOpen(false)}
        title="Encrypted Virtual Contact Bridge & Direct PIN"
      >
        <div style={{ display: "grid", gap: 18 }}>
          <div
            style={{
              background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
              borderRadius: 14,
              padding: 20,
              color: "#ffffff",
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Skilled Hire Virtual Proxy Relay
              </span>
              <Badge tone="green">Active Session</Badge>
            </div>

            <div>
              <span style={{ fontSize: 13, color: "#cbd5e1" }}>Virtual Proxy Number:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "0.02em", color: "#60a5fa" }}>
                  {maskedSessionData.virtualProxyNumber}
                </span>
                <a
                  href={`tel:${maskedSessionData.virtualProxyNumber.replace(/\D/g, "")}`}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  Dial Now 📞
                </a>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                background: "rgba(255,255,255,0.06)",
                padding: "12px 14px",
                borderRadius: 10,
              }}
            >
              <div>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Session Extension:</span>
                <p style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#f8fafc" }}>
                  {maskedSessionData.sessionExtension}
                </p>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Security PIN:</span>
                <p style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#f8fafc" }}>
                  {maskedSessionData.sessionPin}
                </p>
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#94a3b8", display: "grid", gap: 4 }}>
              <div>👤 Your Caller ID Mask: <strong>{maskedSessionData.customerMaskedPhone}</strong></div>
              <div>🔧 Tech Caller ID Mask: <strong>{maskedSessionData.technicianMaskedPhone}</strong></div>
              <div>⏳ Window Expiration: <strong>{maskedSessionData.expiresIn}</strong></div>
            </div>
          </div>

          {/* Dialing Instructions */}
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: "14px 16px",
              border: "1px solid #e2e8f0",
              fontSize: 13,
              color: "#334155",
              lineHeight: 1.5,
            }}
          >
            <strong>How It Works:</strong>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>Dial {maskedSessionData.virtualProxyNumber} from your registered phone.</li>
              <li>When prompted by the automated switchboard, enter extension <strong>{maskedSessionData.sessionExtension}</strong>.</li>
              <li>Enter your 4-digit security PIN <strong>{maskedSessionData.sessionPin}</strong> to connect securely to Marcus Vance.</li>
            </ol>
          </div>

          {/* Emergency Safety Hazard Bypass Notice */}
          <div
            style={{
              background: "#fef2f2",
              borderRadius: 10,
              padding: "14px 16px",
              border: "1px solid #fecaca",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>🚨</span>
              <strong style={{ fontSize: 14, color: "#b91c1c" }}>
                Emergency Safety Hazard Override
              </strong>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#7f1d1d", lineHeight: 1.4 }}>
              If you smell gas (natural gas/propane odour), observe active electrical sparking/arcing, or experience structural water flooding, <strong>do not wait for callback or proxy connection</strong>. Bypass the virtual relay and call our 24/7 Emergency Safety Desk directly:
            </p>
            <a
              href={`tel:${EMERGENCY_SAFETY_DESK_PHONE.replace(/\D/g, "")}`}
              style={{
                color: "#b91c1c",
                fontWeight: 800,
                fontSize: 15,
                textDecoration: "underline",
                marginTop: 2,
              }}
            >
              📞 Direct Emergency Hotline: {EMERGENCY_SAFETY_DESK_PHONE}
            </a>
          </div>

          {/* Statutory Consent Notice */}
          <p style={{ margin: 0, fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
            {maskedSessionData.consentNotice}
          </p>

          <Button
            variant="secondary"
            onClick={() => setIsMaskedBridgeModalOpen(false)}
          >
            Close Bridge Details
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
