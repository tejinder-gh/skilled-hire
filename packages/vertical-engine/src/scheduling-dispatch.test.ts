import { describe, expect, it } from "vitest";
import {
  checkSlotConflict,
  computeTravelBufferMinutes,
  rankCandidatesForSlot,
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
