// packages/vertical-engine/src/job-completion.ts

import type {
  JobCompletionReport,
  CompletionValidationResult,
  InstalledPart,
  PerformedTest,
  CompletionPhoto,
  OutstandingIssue,
  MaintenanceRecommendation,
} from "@marketplace/contracts";

export interface ValidateCompletionInput {
  workSummary: string;
  diagnosis: string;
  workStartedAt: string;
  workCompletedAt: string;
  partsInstalled?: InstalledPart[] | undefined;
  testsPerformed?: PerformedTest[] | undefined;
  beforePhotos?: CompletionPhoto[] | undefined;
  afterPhotos?: CompletionPhoto[] | undefined;
  permitId?: string | null | undefined;
  outstandingIssues?: OutstandingIssue[] | undefined;
  maintenanceRecommendations?: MaintenanceRecommendation[] | undefined;
  contractorAttestation?: {
    attested: boolean;
    technicianName?: string | undefined;
  } | undefined;
  isElectricalOrRegulated?: boolean | undefined;
}

export function validateCompletionReport(
  input: ValidateCompletionInput,
): CompletionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Text validations
  if (!input.workSummary || input.workSummary.trim().length < 5) {
    errors.push("Work summary must be at least 5 characters");
  }
  if (!input.diagnosis || input.diagnosis.trim().length < 5) {
    errors.push("Diagnosis must be at least 5 characters");
  }

  // 2. Chronological timestamps
  const start = new Date(input.workStartedAt).getTime();
  const end = new Date(input.workCompletedAt).getTime();
  if (isNaN(start) || isNaN(end)) {
    errors.push("Invalid work start or completion timestamp");
  } else if (start > end) {
    errors.push("Work start timestamp must precede completion timestamp");
  }

  // 3. Photo evidence
  const beforeCount = input.beforePhotos?.length ?? 0;
  const afterCount = input.afterPhotos?.length ?? 0;
  if (beforeCount < 1) {
    errors.push("At least 1 before-work evidence photo is required");
  }
  if (afterCount < 1) {
    errors.push("At least 1 after-work evidence photo is required");
  }

  // 4. Tests performed & safety
  let requiredTestsPassed = true;
  const tests = input.testsPerformed ?? [];
  const failedTests = tests.filter((t) => t.result === "FAIL");
  if (failedTests.length > 0) {
    const hasUnresolvedIssues =
      (input.outstandingIssues?.length ?? 0) > 0;
    if (!hasUnresolvedIssues) {
      errors.push(
        `Failed safety or diagnostic test(s) present without documented outstanding issues: ${failedTests
          .map((t) => t.testName)
          .join(", ")}`,
      );
      requiredTestsPassed = false;
    } else {
      warnings.push(
        "Tests contain failures with documented outstanding remediation issues",
      );
      requiredTestsPassed = false;
    }
  }

  // 5. Regulatory permit requirement
  const permitRequired = Boolean(input.isElectricalOrRegulated);
  if (permitRequired && !input.permitId) {
    errors.push("Regulated trade job requires verified regulatory permit");
  }

  // 6. Contractor attestation
  const attestationComplete = Boolean(
    input.contractorAttestation?.attested &&
      input.contractorAttestation?.technicianName?.trim(),
  );
  if (!attestationComplete) {
    errors.push("Contractor attestation and technician name are required");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiredTestsPassed,
    permitRequired,
    attestationComplete,
  };
}
