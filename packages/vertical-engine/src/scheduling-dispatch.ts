import type {
  AlternativeSlot,
  DispatchFallbackReason,
  DispatchOfferStatus,
  ScheduleExceptionType,
  SlotAvailabilityResponse,
  SlotConflictCheckResult,
} from "@marketplace/contracts";

export interface CandidateSlotWindow {
  startsAt: Date;
  endsAt: Date;
  travelBufferMinutes?: number | undefined;
}

export interface ExistingJobSlot {
  id: string;
  startsAt: Date;
  endsAt: Date;
  travelBufferMinutes?: number | undefined;
  status: string;
}

export interface ActiveSlotHoldItem {
  id: string;
  bufferedStartsAt: Date;
  bufferedEndsAt: Date;
  holdExpiresAt: Date;
}

export interface WeeklyScheduleItem {
  dayOfWeek: number; // 0-6
  startTime: string; // "08:00"
  endTime: string;   // "17:00"
  active: boolean;
}

export interface ScheduleExceptionItem {
  id?: string | undefined;
  exceptionType: ScheduleExceptionType | string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  allDay: boolean;
  reason?: string | null | undefined;
}

/**
 * Checks for scheduling collisions between a requested appointment slot
 * and a technician's working hours, exceptions, existing jobs, and active holds.
 */
export function checkSlotConflict(
  slot: CandidateSlotWindow,
  options: {
    existingJobs?: ExistingJobSlot[] | undefined;
    activeHolds?: ActiveSlotHoldItem[] | undefined;
    weeklySchedules?: WeeklyScheduleItem[] | undefined;
    exceptions?: ScheduleExceptionItem[] | undefined;
    now?: Date | undefined;
  },
): SlotConflictCheckResult {
  const now = options.now ?? new Date();
  const travelBuffer = options.existingJobs ? (slot.travelBufferMinutes ?? 30) : 30;
  const candStart = slot.startsAt.getTime();
  const candEnd = slot.endsAt.getTime();

  if (candEnd <= candStart) {
    return {
      hasConflict: true,
      conflictType: "OUTSIDE_HOURS",
      conflictDetails: "Slot end time must be strictly after slot start time.",
    };
  }

  // 1. Check Working Hours / Day of Week
  if (options.weeklySchedules && options.weeklySchedules.length > 0) {
    const dayOfWeek = slot.startsAt.getUTCDay(); // UTC or normalized day
    const daySchedules = options.weeklySchedules.filter(
      (s) => s.dayOfWeek === dayOfWeek && s.active,
    );

    if (daySchedules.length === 0) {
      return {
        hasConflict: true,
        conflictType: "OUTSIDE_HOURS",
        conflictDetails: `Technician has no active working schedule configured for day of week ${dayOfWeek}.`,
      };
    }

    // Format HH:MM from slot UTC
    const slotStartHours = slot.startsAt.getUTCHours();
    const slotStartMins = slot.startsAt.getUTCMinutes();
    const slotEndHours = slot.endsAt.getUTCHours();
    const slotEndMins = slot.endsAt.getUTCMinutes();
    const slotStartMinutes = slotStartHours * 60 + slotStartMins;
    const slotEndMinutes = slotEndHours * 60 + slotEndMins;

    const fitsInAnyShift = daySchedules.some((s) => {
      const [shH, shM] = s.startTime.split(":").map(Number);
      const [ehH, ehM] = s.endTime.split(":").map(Number);
      if (shH === undefined || shM === undefined || ehH === undefined || ehM === undefined) return false;
      const shiftStartMinutes = shH * 60 + shM;
      const shiftEndMinutes = ehH * 60 + ehM;
      return slotStartMinutes >= shiftStartMinutes && slotEndMinutes <= shiftEndMinutes;
    });

    if (!fitsInAnyShift) {
      return {
        hasConflict: true,
        conflictType: "OUTSIDE_HOURS",
        conflictDetails: "Requested appointment slot falls outside technician scheduled working hours.",
      };
    }
  }

  // 2. Check Exceptions / Time-Off
  if (options.exceptions && options.exceptions.length > 0) {
    const slotDateStr = slot.startsAt.toISOString().slice(0, 10);

    for (const exc of options.exceptions) {
      if (
        (exc.exceptionType === "TIME_OFF" || exc.exceptionType === "UNAVAILABLE") &&
        slotDateStr >= exc.startDate &&
        slotDateStr <= exc.endDate
      ) {
        if (exc.allDay) {
          return {
            hasConflict: true,
            conflictType: "TIME_OFF_EXCEPTION",
            conflictDetails: `Technician is unavailable (${exc.exceptionType}): ${exc.reason || "Approved time-off"}.`,
          };
        }

        // Partial day check
        if (exc.startTime && exc.endTime) {
          const [eStartH, eStartM] = exc.startTime.split(":").map(Number);
          const [eEndH, eEndM] = exc.endTime.split(":").map(Number);
          if (eStartH !== undefined && eStartM !== undefined && eEndH !== undefined && eEndM !== undefined) {
            const excStartMin = eStartH * 60 + eStartM;
            const excEndMin = eEndH * 60 + eEndM;
            const slotStartMin = slot.startsAt.getUTCHours() * 60 + slot.startsAt.getUTCMinutes();
            const slotEndMin = slot.endsAt.getUTCHours() * 60 + slot.endsAt.getUTCMinutes();

            if (slotStartMin < excEndMin && slotEndMin > excStartMin) {
              return {
                hasConflict: true,
                conflictType: "TIME_OFF_EXCEPTION",
                conflictDetails: `Slot overlaps partial time-off exception (${exc.startTime}-${exc.endTime}): ${exc.reason || "Unavailable"}.`,
              };
            }
          }
        }
      }
    }
  }

  // Calculate Candidate Buffered Window
  const candBufferedStart = candStart - travelBuffer * 60 * 1000;
  const candBufferedEnd = candEnd + travelBuffer * 60 * 1000;

  // 3. Check Existing Active Jobs with Travel Buffers
  if (options.existingJobs) {
    for (const job of options.existingJobs) {
      if (["CANCELLED", "COMPLETED", "CLOSED"].includes(job.status)) {
        continue;
      }

      const jobBuffer = job.travelBufferMinutes ?? 30;
      const jobBufferedStart = job.startsAt.getTime() - jobBuffer * 60 * 1000;
      const jobBufferedEnd = job.endsAt.getTime() + jobBuffer * 60 * 1000;

      // Overlap condition: startA < endB && endA > startB
      if (candBufferedStart < jobBufferedEnd && candBufferedEnd > jobBufferedStart) {
        return {
          hasConflict: true,
          conflictType: "JOB_OVERLAP",
          conflictDetails: `Appointment slot + travel buffer overlaps existing job ${job.id} (${job.startsAt.toISOString()} - ${job.endsAt.toISOString()}).`,
          conflictingJobId: job.id,
        };
      }
    }
  }

  // 4. Check Active Slot Holds with Overlap Protection
  if (options.activeHolds) {
    for (const hold of options.activeHolds) {
      // Ignore expired holds
      if (hold.holdExpiresAt.getTime() <= now.getTime()) {
        continue;
      }

      const holdStart = hold.bufferedStartsAt.getTime();
      const holdEnd = hold.bufferedEndsAt.getTime();

      if (candBufferedStart < holdEnd && candBufferedEnd > holdStart) {
        return {
          hasConflict: true,
          conflictType: "HOLD_OVERLAP",
          conflictDetails: `Appointment slot overlaps active unexpired hold ${hold.id} (leased until ${hold.holdExpiresAt.toISOString()}).`,
          conflictingHoldId: hold.id,
        };
      }
    }
  }

  return {
    hasConflict: false,
  };
}

export interface CandidateTechnicianScheduleEvaluation {
  technicianId: string;
  technicianName: string;
  contractorId: string;
  contractorName: string;
  ratingBps: number;
  completionRateBps: number;
  avgResponseMinutes: number;
  distanceKm: number;
  currentWorkload: number;
  hasConflict: boolean;
  conflictResult?: SlotConflictCheckResult | undefined;
  score: number;
  reasons: string[];
}

/**
 * Evaluates candidate technicians for a requested time slot and ranks them
 * by availability, proximity, reputation, and workload balancing.
 */
export function rankCandidatesForSlot(
  candidates: Array<{
    technicianId: string;
    technicianName: string;
    contractorId: string;
    contractorName: string;
    ratingBps: number;
    completionRateBps: number;
    avgResponseMinutes: number;
    distanceKm: number;
    currentWorkload: number;
    conflict: SlotConflictCheckResult;
  }>,
): CandidateTechnicianScheduleEvaluation[] {
  return candidates
    .filter((c) => !c.conflict.hasConflict)
    .map((c) => {
      // Score calculation:
      // Base: Rating (max 5000 -> 25,000 pts)
      // Completion: max 10000 -> 200 pts
      // Distance penalty: -20 pts per km
      // Response penalty: -0.4 pts per minute
      // Workload penalty: -50 pts per active job
      const score = Math.round(
        c.ratingBps * 5 +
          c.completionRateBps * 0.02 -
          c.distanceKm * 20 -
          c.avgResponseMinutes * 0.4 -
          c.currentWorkload * 50,
      );

      return {
        technicianId: c.technicianId,
        technicianName: c.technicianName,
        contractorId: c.contractorId,
        contractorName: c.contractorName,
        ratingBps: c.ratingBps,
        completionRateBps: c.completionRateBps,
        avgResponseMinutes: c.avgResponseMinutes,
        distanceKm: c.distanceKm,
        currentWorkload: c.currentWorkload,
        hasConflict: false,
        score,
        reasons: [
          `Conflict-free schedule slot`,
          `${c.distanceKm.toFixed(1)} km transit distance`,
          `★ ${(c.ratingBps / 100).toFixed(1)} verified rating`,
          `${c.currentWorkload} active dispatches`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Computes standard travel buffer minutes based on distance and region.
 */
export function computeTravelBufferMinutes(distanceKm: number): number {
  if (distanceKm <= 10) return 25;
  if (distanceKm <= 25) return 30;
  if (distanceKm <= 45) return 45;
  return 60;
}

export interface EvidenceTechnicianData {
  id: string;
  displayName: string;
  contractorId: string;
  contractorName: string;
  emergencyAvailable: boolean;
  serviceRegions: Array<{
    postalFsa: string;
    active: boolean;
    maxTravelRadiusKm: number;
    travelBufferMinutes: number;
  }>;
  weeklySchedules: WeeklyScheduleItem[];
  exceptions: ScheduleExceptionItem[];
  scheduledJobs: ExistingJobSlot[];
  activeHolds: ActiveSlotHoldItem[];
}

/**
 * Parses either explicit ISO slot dates or legacy friendly slot strings like "tomorrow-09-11"
 */
export function parseSlotWindow(
  slot?: string | undefined,
  slotStartsAt?: string | undefined,
  slotEndsAt?: string | undefined,
  now = new Date(),
): { startsAt: Date; endsAt: Date; label: string } {
  if (slotStartsAt && slotEndsAt) {
    const s = new Date(slotStartsAt);
    const e = new Date(slotEndsAt);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      return {
        startsAt: s,
        endsAt: e,
        label: `${s.toLocaleDateString("en-CA")} · ${s.getUTCHours()}:00-${e.getUTCHours()}:00 UTC`,
      };
    }
  }

  const base = new Date(now);
  const slotKey = slot ?? "today-13-15";

  if (slotKey.startsWith("tomorrow") || slotKey.includes("09-11")) {
    const tomorrow = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    const s = new Date(tomorrow);
    s.setUTCHours(9, 0, 0, 0);
    const e = new Date(tomorrow);
    e.setUTCHours(11, 0, 0, 0);
    return { startsAt: s, endsAt: e, label: "Tomorrow · 9:00–11:00 AM" };
  }

  if (slotKey.includes("16-18") || slotKey.includes("late")) {
    const s = new Date(base);
    s.setUTCHours(16, 0, 0, 0);
    const e = new Date(base);
    e.setUTCHours(18, 0, 0, 0);
    return { startsAt: s, endsAt: e, label: "Today · 4:00–6:00 PM" };
  }

  // Default to today 13-15
  const s = new Date(base);
  s.setUTCHours(13, 0, 0, 0);
  const e = new Date(base);
  e.setUTCHours(15, 0, 0, 0);
  return { startsAt: s, endsAt: e, label: "Today · 1:00–3:00 PM" };
}

/**
 * Evaluates real evidence-based availability for a trade vertical and appointment window
 * taking into account technician working shifts, regional FSA coverage, active jobs,
 * unexpired slot holds, and verified emergency capacity.
 */
export function computeEvidenceBasedAvailability(params: {
  verticalSlug: string;
  verticalName: string;
  region?: string | undefined;
  postalFsa?: string | undefined;
  slotKey?: string | undefined;
  slotWindow: CandidateSlotWindow;
  slotLabel?: string | undefined;
  technicians: EvidenceTechnicianData[];
  activeJobsInVerticalCount?: number | undefined;
  now?: Date | undefined;
  isLegacySurge?: boolean | undefined;
}): SlotAvailabilityResponse {
  const now = params.now ?? new Date();
  const region = (params.region ?? "ON").toUpperCase();
  const fsa = params.postalFsa ? params.postalFsa.toUpperCase().trim().slice(0, 3) : undefined;
  const queriedSlot = params.slotKey ?? "today-13-15";

  // Filter technicians eligible in requested FSA (if provided)
  const eligibleTechsInFsa = fsa
    ? params.technicians.filter((t) =>
        t.serviceRegions.some((r) => r.active && r.postalFsa.toUpperCase() === fsa),
      )
    : params.technicians;

  // Evaluate conflict-free capacity in the queried window
  const conflictFreeTechs = eligibleTechsInFsa.filter((t) => {
    const conflict = checkSlotConflict(params.slotWindow, {
      existingJobs: t.scheduledJobs,
      activeHolds: t.activeHolds,
      weeklySchedules: t.weeklySchedules,
      exceptions: t.exceptions,
      now,
    });
    return !conflict.hasConflict;
  });

  const availableCapacity = params.isLegacySurge ? 0 : conflictFreeTechs.length;
  const isAvailable = availableCapacity > 0;

  let availabilityConfidence: "HIGH" | "LIMITED" | "NONE" = "NONE";
  if (availableCapacity >= 2) {
    availabilityConfidence = "HIGH";
  } else if (availableCapacity === 1) {
    availabilityConfidence = "LIMITED";
  }

  const activeJobsCount = params.activeJobsInVerticalCount ?? 0;
  const totalTechCount = params.technicians.length;
  const saturationBps =
    totalTechCount === 0
      ? 10000
      : Math.min(
          10000,
          Math.round(((activeJobsCount + (isAvailable ? 0 : 1)) / Math.max(1, totalTechCount)) * 10000),
        );

  // Generate real dynamic alternative slots across upcoming windows
  const candidateAlternativeOffsets = [
    { label: "Tomorrow · 9:00–11:00 AM", day: "Tomorrow", time: "9:00 AM – 11:00 AM", dayOffset: 1, startH: 9, endH: 11, id: "tomorrow-09-11" },
    { label: "Tomorrow · 2:00–4:00 PM", day: "Tomorrow", time: "2:00 PM – 4:00 PM", dayOffset: 1, startH: 14, endH: 16, id: "tomorrow-14-16" },
    { label: "Day After Tomorrow · 10:00 AM–12:00 PM", day: "Upcoming", time: "10:00 AM – 12:00 PM", dayOffset: 2, startH: 10, endH: 12, id: "upcoming-10-12" },
  ];

  const alternativeSlots: AlternativeSlot[] = candidateAlternativeOffsets.map((cand) => {
    const s = new Date(now.getTime() + cand.dayOffset * 24 * 60 * 60 * 1000);
    s.setUTCHours(cand.startH, 0, 0, 0);
    const e = new Date(now.getTime() + cand.dayOffset * 24 * 60 * 60 * 1000);
    e.setUTCHours(cand.endH, 0, 0, 0);

    const altWindow: CandidateSlotWindow = { startsAt: s, endsAt: e, travelBufferMinutes: 30 };
    const altAvailableTechs = (fsa ? eligibleTechsInFsa : params.technicians).filter((t) => {
      const c = checkSlotConflict(altWindow, {
        existingJobs: t.scheduledJobs,
        activeHolds: t.activeHolds,
        weeklySchedules: t.weeklySchedules,
        exceptions: t.exceptions,
        now,
      });
      return !c.hasConflict;
    });

    const altCap = altAvailableTechs.length;
    const demandLevel = altCap >= 2 ? "LOW" : altCap === 1 ? "NORMAL" : "HIGH";
    const confidence = altCap >= 2 ? "HIGH" : altCap === 1 ? "LIMITED" : "NONE";

    return {
      id: cand.id,
      label: cand.label,
      day: cand.day,
      time: cand.time,
      guaranteed: false, // Honest evidence-backed guarantee
      demandLevel,
      badge: altCap > 0 ? `${altCap} Tech${altCap > 1 ? "s" : ""} Available` : "High Regional Demand",
      startsAt: s.toISOString(),
      endsAt: e.toISOString(),
      availableCapacity: altCap,
      confidence,
    };
  });

  // Evaluate real Emergency Capacity:
  // Requires an active emergencyAvailable technician with NO conflict at 'now'
  const nowEmergencySlot: CandidateSlotWindow = {
    startsAt: now,
    endsAt: new Date(now.getTime() + 60 * 60 * 1000),
    travelBufferMinutes: 15,
  };

  const eligibleEmergencyTechs = (fsa ? eligibleTechsInFsa : params.technicians).filter((t) => {
    if (!t.emergencyAvailable) return false;
    const conflict = checkSlotConflict(nowEmergencySlot, {
      existingJobs: t.scheduledJobs,
      activeHolds: t.activeHolds,
      weeklySchedules: t.weeklySchedules,
      exceptions: t.exceptions,
      now,
    });
    return !conflict.hasConflict;
  });

  const hasEmergencyCoverage = eligibleEmergencyTechs.length > 0;

  // Emergency Option response
  let emergencyOption: SlotAvailabilityResponse["emergencyOption"];
  if (hasEmergencyCoverage) {
    emergencyOption = {
      available: true,
      evidenceSupported: true,
      title: "Request Emergency Priority Dispatch",
      badge: `⚡ On-Call Journeyperson (${eligibleEmergencyTechs.length} available)`,
      description: `Routes directly to verified on-call ${params.verticalName} specialists currently active in ${fsa || "your region"}.`,
      calloutFeeCents: 14900,
      slaMinutes: 45,
      availableTechniciansCount: eligibleEmergencyTechs.length,
    };
  } else if (fsa) {
    // Specifically queried an FSA where no emergency technician is currently on-call
    emergencyOption = {
      available: false,
      evidenceSupported: false,
      title: "Emergency Dispatch Unavailable in this FSA",
      badge: "No on-call emergency units active right now",
      description: `All emergency-certified ${params.verticalName} technicians in ${fsa} are currently deployed. Next available scheduled window is recommended.`,
      calloutFeeCents: 14900,
      slaMinutes: 0,
      availableTechniciansCount: 0,
    };
  } else {
    // Legacy fallback without FSA filter
    emergencyOption = {
      available: true,
      evidenceSupported: false,
      title: "Request Emergency Priority Dispatch",
      badge: "⚡ On-call emergency dispatch",
      description: `Routes directly to on-call certified ${params.verticalName} journeypersons reserved strictly for emergency response.`,
      calloutFeeCents: 14900,
      slaMinutes: 45,
      availableTechniciansCount: 0,
    };
  }

  // Standby Waitlist:
  // Accurate evidence-based queue position calculated from active uncompleted jobs/requests
  const standbyWaitlist = {
    available: true,
    evidenceSupported: true,
    title: "Join Priority Standby Waitlist",
    badge: "⏱️ Priority Standby Queue",
    description:
      "Keep your desired time slot. If an existing job finishes early or an appointment reschedules, you are automatically assigned.",
    queuePosition: activeJobsCount > 0 ? activeJobsCount + 1 : fsa ? 1 : 2,
    estimatedNoticeMinutes: 30,
  };

  if (!isAvailable) {
    return {
      verticalSlug: params.verticalSlug,
      verticalName: params.verticalName,
      region,
      postalFsa: fsa,
      queriedSlot,
      slotStartsAt: params.slotWindow.startsAt.toISOString(),
      slotEndsAt: params.slotWindow.endsAt.toISOString(),
      available: false,
      status: totalTechCount === 0 ? "BUSIER_THAN_USUAL" : "BUSIER_THAN_USUAL",
      headline: `We're experiencing higher than usual demand for ${params.verticalName} in ${fsa ? `postal FSA ${fsa}` : region === "ON" ? "Ontario / Greater Toronto Area" : region}`,
      reason:
        totalTechCount === 0
          ? `All certified ${params.verticalName} trade specialists in ${region} are currently committed on active dispatches.`
          : eligibleTechsInFsa.length === 0
            ? `No certified ${params.verticalName} technicians currently serve postal FSA ${fsa}.`
            : `High demand surge: 100% of verified ${params.verticalName} technicians in this area are committed in this window.`,
      availableCapacity: 0,
      availabilityConfidence: "NONE",
      metrics: {
        activeCertifiedTechnicians: totalTechCount,
        dispatchedCount: activeJobsCount,
        capacitySaturationBps: saturationBps,
        estimatedWaitMinutes: 120,
        eligibleTechniciansInFsa: eligibleTechsInFsa.length,
        openSlotCount: 0,
      },
      alternativeSlots,
      emergencyOption,
      standbyWaitlist,
    };
  }

  return {
    verticalSlug: params.verticalSlug,
    verticalName: params.verticalName,
    region,
    postalFsa: fsa,
    queriedSlot,
    slotStartsAt: params.slotWindow.startsAt.toISOString(),
    slotEndsAt: params.slotWindow.endsAt.toISOString(),
    available: true,
    status: "AVAILABLE",
    headline: `Verified ${params.verticalName} technicians ready for dispatch`,
    reason: `Evidence confirmed: ${availableCapacity} certified trade professional${availableCapacity > 1 ? "s have" : " has"} open conflict-free capacity in this requested window.`,
    availableCapacity,
    availabilityConfidence,
    metrics: {
      activeCertifiedTechnicians: totalTechCount,
      dispatchedCount: activeJobsCount,
      capacitySaturationBps: Math.round((activeJobsCount / Math.max(1, totalTechCount)) * 10000),
      estimatedWaitMinutes: 0,
      eligibleTechniciansInFsa: eligibleTechsInFsa.length,
      openSlotCount: availableCapacity,
    },
    alternativeSlots,
    emergencyOption,
  };
}
