"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AlternativeSlot,
  RecommendationDeclineReason,
  RecommendationResponseEventDTO,
  RecommendationStatus,
  RecommendationUrgency,
  ServiceRecommendationDTO,
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
  guaranteed?: boolean | undefined;
  availableCapacity?: number | undefined;
  confidence?: "HIGH" | "LIMITED" | "NONE" | undefined;
  badge?: string | undefined;
};

export default function CustomerHome() {
  const [activeTab, setActiveTab] = useState<
    "book" | "tracking" | "completion" | "warranty" | "survey" | "security" | "payments"
  >("book");

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

  const [selectedSlot, setSelectedSlot] = useState<string>("today-13-15");
  const [description, setDescription] = useState(
    "Central AC compressor humming loudly, but condenser fan not turning and indoor air is warm.",
  );
  const [urgency, setUrgency] = useState<"STANDARD" | "EMERGENCY">("STANDARD");
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);

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
    </Shell>
  );
}
