import type {
  DispatchFallbackReason,
  DispatchOfferStatus,
  ScheduleExceptionType,
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
