import { describe, expect, it } from "vitest";
import {
  checkSlotConflict,
  computeEvidenceBasedAvailability,
  computeTravelBufferMinutes,
  parseSlotWindow,
  rankCandidatesForSlot,
  type EvidenceTechnicianData,
} from "./scheduling-dispatch.js";

describe("Technician Scheduling & Dispatch Conflict Engine (SH-06)", () => {
  const baseDate = new Date("2026-10-15T14:00:00Z"); // Thursday
  const slotStart = new Date("2026-10-15T14:00:00Z");
  const slotEnd = new Date("2026-10-15T16:00:00Z");

  it("detects job overlap when appointment window collides directly", () => {
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd, travelBufferMinutes: 30 },
      {
        existingJobs: [
          {
            id: "job-1",
            startsAt: new Date("2026-10-15T15:00:00Z"),
            endsAt: new Date("2026-10-15T17:00:00Z"),
            status: "ASSIGNED",
          },
        ],
      },
    );

    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe("JOB_OVERLAP");
    expect(conflict.conflictingJobId).toBe("job-1");
  });

  it("detects job overlap when travel buffer extends into another job", () => {
    // Candidate slot ends at 14:00. Next job starts at 14:20.
    // With 30 min buffer on candidate slot (ends at 14:30), collision occurs!
    const slotAStart = new Date("2026-10-15T12:00:00Z");
    const slotAEnd = new Date("2026-10-15T14:00:00Z");

    const conflict = checkSlotConflict(
      { startsAt: slotAStart, endsAt: slotAEnd, travelBufferMinutes: 30 },
      {
        existingJobs: [
          {
            id: "job-2",
            startsAt: new Date("2026-10-15T14:20:00Z"),
            endsAt: new Date("2026-10-15T16:00:00Z"),
            travelBufferMinutes: 30,
            status: "WORK_IN_PROGRESS",
          },
        ],
      },
    );

    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe("JOB_OVERLAP");
  });

  it("detects hold overlap for active unexpired slot holds", () => {
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd, travelBufferMinutes: 30 },
      {
        activeHolds: [
          {
            id: "hold-1",
            bufferedStartsAt: new Date("2026-10-15T13:30:00Z"),
            bufferedEndsAt: new Date("2026-10-15T16:30:00Z"),
            holdExpiresAt: new Date("2026-10-15T14:15:00Z"), // Not expired yet
          },
        ],
        now: new Date("2026-10-15T14:05:00Z"),
      },
    );

    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe("HOLD_OVERLAP");
    expect(conflict.conflictingHoldId).toBe("hold-1");
  });

  it("ignores expired slot holds", () => {
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd, travelBufferMinutes: 30 },
      {
        activeHolds: [
          {
            id: "hold-expired",
            bufferedStartsAt: new Date("2026-10-15T13:30:00Z"),
            bufferedEndsAt: new Date("2026-10-15T16:30:00Z"),
            holdExpiresAt: new Date("2026-10-15T13:59:00Z"), // Expired
          },
        ],
        now: new Date("2026-10-15T14:05:00Z"),
      },
    );

    expect(conflict.hasConflict).toBe(false);
  });

  it("detects conflict when appointment is outside technician working hours", () => {
    // Thursday is day 4
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd },
      {
        weeklySchedules: [
          {
            dayOfWeek: 4,
            startTime: "08:00",
            endTime: "12:00", // Shift ends at 12:00, slot is 14:00-16:00
            active: true,
          },
        ],
      },
    );

    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe("OUTSIDE_HOURS");
  });

  it("detects conflict when technician has an approved time-off exception", () => {
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd },
      {
        exceptions: [
          {
            exceptionType: "TIME_OFF",
            startDate: "2026-10-15",
            endDate: "2026-10-15",
            allDay: true,
            reason: "HVAC Technical Recertification Workshop",
          },
        ],
      },
    );

    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe("TIME_OFF_EXCEPTION");
  });

  it("passes conflict check when slot is completely clear and within shift", () => {
    const conflict = checkSlotConflict(
      { startsAt: slotStart, endsAt: slotEnd, travelBufferMinutes: 30 },
      {
        weeklySchedules: [
          {
            dayOfWeek: 4,
            startTime: "08:00",
            endTime: "18:00",
            active: true,
          },
        ],
        existingJobs: [
          {
            id: "job-morning",
            startsAt: new Date("2026-10-15T09:00:00Z"),
            endsAt: new Date("2026-10-15T11:00:00Z"),
            travelBufferMinutes: 30,
            status: "COMPLETED",
          },
        ],
      },
    );

    expect(conflict.hasConflict).toBe(false);
  });

  it("ranks candidates and filters out conflicted technicians", () => {
    const candidates = [
      {
        technicianId: "tech-1",
        technicianName: "Alex Journeyperson",
        contractorId: "con-1",
        contractorName: "Maple HVAC",
        ratingBps: 4900,
        completionRateBps: 9800,
        avgResponseMinutes: 12,
        distanceKm: 5.2,
        currentWorkload: 1,
        conflict: { hasConflict: false },
      },
      {
        technicianId: "tech-2",
        technicianName: "Busy Tech",
        contractorId: "con-2",
        contractorName: "Toronto Air",
        ratingBps: 5000,
        completionRateBps: 9900,
        avgResponseMinutes: 8,
        distanceKm: 3.1,
        currentWorkload: 2,
        conflict: {
          hasConflict: true,
          conflictType: "JOB_OVERLAP" as const,
        },
      },
      {
        technicianId: "tech-3",
        technicianName: "Far Journeyperson",
        contractorId: "con-3",
        contractorName: "GTA Mechanical",
        ratingBps: 4800,
        completionRateBps: 9500,
        avgResponseMinutes: 20,
        distanceKm: 28.0,
        currentWorkload: 0,
        conflict: { hasConflict: false },
      },
    ];

    const ranked = rankCandidatesForSlot(candidates);

    // tech-2 is excluded due to conflict
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.technicianId).toBe("tech-1");
    expect(ranked[1]?.technicianId).toBe("tech-3");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("computes travel buffers appropriately by distance", () => {
    expect(computeTravelBufferMinutes(5)).toBe(25);
    expect(computeTravelBufferMinutes(20)).toBe(30);
    expect(computeTravelBufferMinutes(35)).toBe(45);
    expect(computeTravelBufferMinutes(60)).toBe(60);
  });
});

describe("Evidence-Backed Booking Availability & SLA Claims Engine (SH-02)", () => {
  const baseTime = new Date("2026-10-15T10:00:00Z"); // Thursday 10:00 UTC
  const slotWindow = {
    startsAt: new Date("2026-10-15T13:00:00Z"),
    endsAt: new Date("2026-10-15T15:00:00Z"),
    travelBufferMinutes: 30,
  };

  const sampleTechs: EvidenceTechnicianData[] = [
    {
      id: "tech-101",
      displayName: "Marcus S.",
      contractorId: "con-1",
      contractorName: "Toronto HVAC Pros",
      emergencyAvailable: true,
      serviceRegions: [
        { postalFsa: "M5V", active: true, maxTravelRadiusKm: 25, travelBufferMinutes: 30 },
        { postalFsa: "M5R", active: true, maxTravelRadiusKm: 25, travelBufferMinutes: 30 },
      ],
      weeklySchedules: [
        { dayOfWeek: 4, startTime: "08:00", endTime: "18:00", active: true },
      ],
      exceptions: [],
      scheduledJobs: [],
      activeHolds: [],
    },
    {
      id: "tech-102",
      displayName: "Elena R.",
      contractorId: "con-1",
      contractorName: "Toronto HVAC Pros",
      emergencyAvailable: false,
      serviceRegions: [
        { postalFsa: "M5V", active: true, maxTravelRadiusKm: 25, travelBufferMinutes: 30 },
      ],
      weeklySchedules: [
        { dayOfWeek: 4, startTime: "08:00", endTime: "18:00", active: true },
      ],
      exceptions: [],
      scheduledJobs: [],
      activeHolds: [],
    },
    {
      id: "tech-103",
      displayName: "David K.",
      contractorId: "con-2",
      contractorName: "York Heating",
      emergencyAvailable: true,
      serviceRegions: [
        { postalFsa: "L4B", active: true, maxTravelRadiusKm: 25, travelBufferMinutes: 30 }, // Different FSA!
      ],
      weeklySchedules: [
        { dayOfWeek: 4, startTime: "08:00", endTime: "18:00", active: true },
      ],
      exceptions: [],
      scheduledJobs: [],
      activeHolds: [],
    },
  ];

  it("calculates high availability confidence when multiple conflict-free technicians cover FSA", () => {
    const res = computeEvidenceBasedAvailability({
      verticalSlug: "hvac",
      verticalName: "Heating & Cooling",
      postalFsa: "M5V",
      slotWindow,
      technicians: sampleTechs,
      now: baseTime,
    });

    expect(res.available).toBe(true);
    expect(res.status).toBe("AVAILABLE");
    expect(res.availableCapacity).toBe(2); // tech-101 and tech-102 cover M5V
    expect(res.availabilityConfidence).toBe("HIGH");
    expect(res.metrics?.eligibleTechniciansInFsa).toBe(2);
    expect(res.metrics?.openSlotCount).toBe(2);
  });

  it("downgrades confidence to LIMITED when only 1 technician is available", () => {
    // Put tech-102 in a conflicting job
    const techsWithBusyElena: EvidenceTechnicianData[] = [
      sampleTechs[0]!,
      {
        ...sampleTechs[1]!,
        scheduledJobs: [
          {
            id: "job-99",
            startsAt: new Date("2026-10-15T13:30:00Z"),
            endsAt: new Date("2026-10-15T14:30:00Z"),
            status: "ASSIGNED",
          },
        ],
      },
    ];

    const res = computeEvidenceBasedAvailability({
      verticalSlug: "hvac",
      verticalName: "Heating & Cooling",
      postalFsa: "M5V",
      slotWindow,
      technicians: techsWithBusyElena,
      now: baseTime,
    });

    expect(res.available).toBe(true);
    expect(res.availableCapacity).toBe(1);
    expect(res.availabilityConfidence).toBe("LIMITED");
  });

  it("detects no capacity when unexpired slot hold reserves the only available technician", () => {
    // tech-101 has an active unexpired hold
    const techsWithHold: EvidenceTechnicianData[] = [
      {
        ...sampleTechs[0]!,
        activeHolds: [
          {
            id: "hold-active",
            bufferedStartsAt: new Date("2026-10-15T12:30:00Z"),
            bufferedEndsAt: new Date("2026-10-15T15:30:00Z"),
            holdExpiresAt: new Date("2026-10-15T10:15:00Z"), // Expires in 15 mins (after baseTime 10:00)
          },
        ],
      },
    ];

    const res = computeEvidenceBasedAvailability({
      verticalSlug: "hvac",
      verticalName: "Heating & Cooling",
      postalFsa: "M5V",
      slotWindow,
      technicians: techsWithHold,
      activeJobsInVerticalCount: 1,
      now: baseTime,
    });

    expect(res.available).toBe(false);
    expect(res.availableCapacity).toBe(0);
    expect(res.availabilityConfidence).toBe("NONE");
    expect(res.standbyWaitlist?.available).toBe(true);
    expect(res.standbyWaitlist?.queuePosition).toBe(2); // 1 active job + 1 = 2
  });

  it("fails closed on emergency SLA claims when no on-call emergency technician serves FSA", () => {
    // Only tech-102 covers M5V, but tech-102 is NOT emergencyAvailable
    const noEmergencyTechs = [sampleTechs[1]!];

    const res = computeEvidenceBasedAvailability({
      verticalSlug: "hvac",
      verticalName: "Heating & Cooling",
      postalFsa: "M5V",
      slotWindow,
      technicians: noEmergencyTechs,
      now: baseTime,
    });

    expect(res.emergencyOption?.available).toBe(false);
    expect(res.emergencyOption?.evidenceSupported).toBe(false);
    expect(res.emergencyOption?.slaMinutes).toBe(0);
    expect(res.emergencyOption?.availableTechniciansCount).toBe(0);
  });

  it("validates evidence-backed emergency SLA when on-call technician is open and conflict-free", () => {
    const res = computeEvidenceBasedAvailability({
      verticalSlug: "hvac",
      verticalName: "Heating & Cooling",
      postalFsa: "M5V",
      slotWindow,
      technicians: sampleTechs,
      now: baseTime,
    });

    expect(res.emergencyOption?.available).toBe(true);
    expect(res.emergencyOption?.evidenceSupported).toBe(true);
    expect(res.emergencyOption?.slaMinutes).toBe(45);
    expect(res.emergencyOption?.availableTechniciansCount).toBe(1); // tech-101
  });

  it("parses explicit ISO dates as well as legacy slot labels", () => {
    const parsedIso = parseSlotWindow(
      undefined,
      "2026-10-20T14:00:00Z",
      "2026-10-20T16:00:00Z",
      baseTime,
    );
    expect(parsedIso.startsAt.toISOString()).toBe("2026-10-20T14:00:00.000Z");
    expect(parsedIso.endsAt.toISOString()).toBe("2026-10-20T16:00:00.000Z");

    const parsedTomorrow = parseSlotWindow("tomorrow-09-11", undefined, undefined, baseTime);
    expect(parsedTomorrow.startsAt.getUTCHours()).toBe(9);
    expect(parsedTomorrow.endsAt.getUTCHours()).toBe(11);
  });
});
