export type SlotHoldStatus =
  | "HELD"
  | "CONFIRMED"
  | "RELEASED"
  | "EXPIRED";

export type DispatchOfferStatus =
  | "OFFERED"
  | "ACCEPTED"
  | "DECLINED"
  | "TIMED_OUT"
  | "RESCINDED";

export type ScheduleExceptionType =
  | "TIME_OFF"
  | "UNAVAILABLE"
  | "OVERTIME"
  | "CUSTOM_HOURS";

export type DispatchFallbackReason =
  | "ALL_OFFERS_EXHAUSTED"
  | "TIMED_OUT"
  | "DECLINED_BY_ALL"
  | "NO_ELIGIBLE_CANDIDATES"
  | "MANUAL_ESCALATION";

export type DispatchFallbackStatus =
  | "PENDING_TRIAGE"
  | "MANUALLY_ASSIGNED"
  | "RE_DISPATCHED"
  | "CANCELLED";

export interface TechnicianScheduleDTO {
  id: string;
  technicianId: string;
  contractorId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: string; // "HH:MM" e.g. "08:00"
  endTime: string; // "HH:MM" e.g. "17:00"
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicianScheduleExceptionDTO {
  id: string;
  technicianId: string;
  exceptionType: ScheduleExceptionType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  allDay: boolean;
  reason?: string | null | undefined;
  approvedByUserId?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicianServiceRegionDTO {
  id: string;
  technicianId: string;
  contractorId: string;
  postalFsa: string; // e.g. "M5V"
  maxTravelRadiusKm: number;
  travelBufferMinutes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchSlotHoldDTO {
  id: string;
  serviceRequestId: string;
  technicianId: string;
  contractorId: string;
  slotStartsAt: string;
  slotEndsAt: string;
  travelBufferMinutes: number;
  bufferedStartsAt: string;
  bufferedEndsAt: string;
  status: SlotHoldStatus;
  holdExpiresAt: string;
  heldByUserId?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchOfferDTO {
  id: string;
  serviceRequestId: string;
  technicianId: string;
  contractorId: string;
  slotHoldId?: string | null | undefined;
  candidateRank: number;
  candidateScore: number;
  status: DispatchOfferStatus;
  offeredAt: string;
  expiresAt: string;
  respondedAt?: string | null | undefined;
  declineReason?: string | null | undefined;
  declineNotes?: string | null | undefined;
  technicianName?: string | undefined;
  contractorName?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchFallbackQueueItemDTO {
  id: string;
  serviceRequestId: string;
  failedOfferCount: number;
  reason: DispatchFallbackReason;
  status: DispatchFallbackStatus;
  assignedTechnicianId?: string | null | undefined;
  triagedByUserId?: string | null | undefined;
  triagedAt?: string | null | undefined;
  resolutionNotes?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
  serviceRequest?: {
    id: string;
    description: string;
    urgency: string;
    postalCode?: string | undefined;
    region?: string | undefined;
    verticalName?: string | undefined;
    preferredStartsAt?: string | null | undefined;
    preferredEndsAt?: string | null | undefined;
  } | undefined;
}

export interface CreateSlotHoldInput {
  serviceRequestId: string;
  technicianId: string;
  slotStartsAt: string;
  slotEndsAt: string;
  travelBufferMinutes?: number | undefined;
}

export interface SlotConflictCheckResult {
  hasConflict: boolean;
  conflictType?:
    | "JOB_OVERLAP"
    | "HOLD_OVERLAP"
    | "OUTSIDE_HOURS"
    | "TIME_OFF_EXCEPTION"
    | undefined;
  conflictDetails?: string | undefined;
  conflictingJobId?: string | undefined;
  conflictingHoldId?: string | undefined;
}

export interface GenerateOffersInput {
  serviceRequestId?: string | undefined;
  slotStartsAt: string;
  slotEndsAt: string;
  maxOffers?: number | undefined;
  offerTtlMinutes?: number | undefined;
}

export interface AcceptOfferInput {
  responseNotes?: string | undefined;
}

export interface DeclineOfferInput {
  declineReason: string;
  declineNotes?: string | undefined;
}

export interface TriageFallbackInput {
  action: "MANUAL_ASSIGN" | "RE_DISPATCH" | "CANCEL";
  technicianId?: string | undefined;
  overrideReason?: string | undefined;
  resolutionNotes?: string | undefined;
}

export interface TechnicianCalendarJobSlot {
  id: string;
  serviceRequestId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  customerAddress?: string | undefined;
  travelBufferMinutes: number;
}

export interface TechnicianAvailabilityCalendarDTO {
  technicianId: string;
  technicianName: string;
  contractorId: string;
  contractorName: string;
  weeklySchedule: TechnicianScheduleDTO[];
  exceptions: TechnicianScheduleExceptionDTO[];
  serviceRegions: TechnicianServiceRegionDTO[];
  scheduledJobs: TechnicianCalendarJobSlot[];
  activeHolds: DispatchSlotHoldDTO[];
}

export interface SlotAvailabilityQuery {
  vertical?: string | undefined;
  region?: string | undefined;
  postalCode?: string | undefined;
  fsa?: string | undefined;
  slot?: string | undefined;
  slotStartsAt?: string | undefined;
  slotEndsAt?: string | undefined;
  urgency?: "STANDARD" | "EMERGENCY" | undefined;
}

export interface InstantSlotReservationInput {
  verticalSlug: string;
  postalCode: string;
  slotStartsAt: string;
  slotEndsAt: string;
  serviceRequestId?: string | undefined;
  urgency?: "STANDARD" | "EMERGENCY" | undefined;
}

export interface InstantSlotReservationResult {
  success: boolean;
  holdId?: string | undefined;
  holdToken?: string | undefined;
  technicianId?: string | undefined;
  technicianName?: string | undefined;
  contractorId?: string | undefined;
  slotStartsAt?: string | undefined;
  slotEndsAt?: string | undefined;
  holdExpiresAt?: string | undefined;
  expiresInSeconds?: number | undefined;
  status: "HELD" | "UNAVAILABLE" | "EXPIRED";
  reason?: string | undefined;
}

export interface ConfirmSlotReservationInput {
  holdId?: string | undefined;
  holdToken?: string | undefined;
  serviceRequestId?: string | undefined;
  customerId?: string | undefined;
  propertyId?: string | undefined;
  notes?: string | undefined;
}

export interface ConfirmSlotReservationResult {
  success: boolean;
  jobId?: string | undefined;
  serviceRequestId?: string | undefined;
  technicianId?: string | undefined;
  scheduledStartsAt?: string | undefined;
  scheduledEndsAt?: string | undefined;
  status: "CONFIRMED" | "HOLD_EXPIRED" | "NOT_FOUND";
  reason?: string | undefined;
}
