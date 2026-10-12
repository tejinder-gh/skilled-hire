import { describe, expect, it } from "vitest";
import type {
  AgreementSignatureRecord,
  LegalAgreementRecord,
} from "@marketplace/contracts";
import {
  buildEvidenceCertificate,
  computeAgreementChecksum,
  evaluateLegalDispatchGate,
  verifySignatureEvidence,
} from "./legal.js";

describe("Legal Agreement & Provider Indemnity Engine", () => {
  const dummyText = "# Master ICA (Ontario)\nContractor indemnifies platform.";
  const checksum = computeAgreementChecksum(dummyText);

  const mockAgreement: LegalAgreementRecord = {
    id: "agr-1111-ica",
    type: "INDEPENDENT_CONTRACTOR_AGREEMENT",
    version: "1.0.0",
    jurisdiction: "ON",
    title: "Master ICA Ontario",
    summary: "Independent contractor agreement with indemnity protocol",
    contentMarkdown: dummyText,
    contentChecksum: checksum,
    isActive: true,
    effectiveDate: "2026-10-01T00:00:00.000Z",
    legalCounselRef: "ON-LEGAL-2026-ICA-771",
    keyTerms: {
      intermediaryModel: "INDEPENDENT_CONTRACTOR_MARKETPLACE",
      indemnityScope: "FULL_TRADE_DEFENSE_AND_INDEMNITY",
      permitResponsibility: "CONTRACTOR_EXCLUSIVE",
      platformNegligenceCarveout: true,
      nonWaivableRightsProtected: true,
      governingLaw: "ONTARIO_CANADA",
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  const mockValidSignature: AgreementSignatureRecord = {
    id: "sig-2222",
    agreementId: "agr-1111-ica",
    agreementType: "INDEPENDENT_CONTRACTOR_AGREEMENT",
    agreementVersion: "1.0.0",
    jurisdiction: "ON",
    signerUserId: "usr-owner-1",
    signerRole: "CONTRACTOR_OWNER",
    entityType: "CONTRACTOR",
    contractorId: "cnt-1",
    signerLegalName: "Jane Doe",
    signerTitle: "President",
    ipAddress: "198.51.100.42",
    userAgent: "Mozilla/5.0 (Macintosh)",
    agreementChecksum: checksum,
    signedAt: "2026-10-05T12:00:00.000Z",
    metadata: {},
  };

  it("computes deterministic SHA-256 checksum", () => {
    const hash1 = computeAgreementChecksum("Hello World");
    const hash2 = computeAgreementChecksum("Hello World");
    const hash3 = computeAgreementChecksum("Different Text");
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64);
  });

  it("validates signature evidence when checksum, version, and id match", () => {
    const res = verifySignatureEvidence({
      agreement: mockAgreement,
      signature: mockValidSignature,
    });
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("detects tampered signature checksum mismatch", () => {
    const tampered = {
      ...mockValidSignature,
      agreementChecksum: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    const res = verifySignatureEvidence({
      agreement: mockAgreement,
      signature: tampered,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("checksum mismatch");
  });

  it("detects revoked signatures", () => {
    const revoked = {
      ...mockValidSignature,
      revokedAt: "2026-10-10T00:00:00.000Z",
    };
    const res = verifySignatureEvidence({
      agreement: mockAgreement,
      signature: revoked,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("revoked");
  });

  it("detects version mismatch when agreement has been superseded", () => {
    const outdatedSig = {
      ...mockValidSignature,
      agreementVersion: "0.9.0",
    };
    const res = verifySignatureEvidence({
      agreement: mockAgreement,
      signature: outdatedSig,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("version mismatch");
  });

  it("fails closed on legal dispatch gate when contractor signature is missing", () => {
    const gate = evaluateLegalDispatchGate({
      contractorAgreement: mockAgreement,
      contractorSignature: null,
    });
    expect(gate.canDispatch).toBe(false);
    expect(gate.denyCodes).toContain("CONTRACTOR_AGREEMENT_REQUIRED");
    expect(gate.failClosedReason).toContain("Contractor has not signed");
  });

  it("fails closed on legal dispatch gate when customer agreement is missing", () => {
    const custAgreement: LegalAgreementRecord = {
      ...mockAgreement,
      id: "agr-customer",
      type: "CUSTOMER_SERVICE_TERMS",
    };
    const gate = evaluateLegalDispatchGate({
      contractorAgreement: mockAgreement,
      contractorSignature: mockValidSignature,
      customerAgreement: custAgreement,
      customerSignature: null,
    });
    expect(gate.canDispatch).toBe(false);
    expect(gate.denyCodes).toContain("CUSTOMER_TERMS_REQUIRED");
  });

  it("allows dispatch when both contractor and customer agreements are valid", () => {
    const custAgreement: LegalAgreementRecord = {
      ...mockAgreement,
      id: "agr-customer",
      type: "CUSTOMER_SERVICE_TERMS",
    };
    const custSig: AgreementSignatureRecord = {
      ...mockValidSignature,
      id: "sig-cust",
      agreementId: "agr-customer",
      agreementType: "CUSTOMER_SERVICE_TERMS",
      entityType: "CUSTOMER",
      contractorId: null,
    };
    const gate = evaluateLegalDispatchGate({
      contractorAgreement: mockAgreement,
      contractorSignature: mockValidSignature,
      customerAgreement: custAgreement,
      customerSignature: custSig,
    });
    expect(gate.canDispatch).toBe(true);
    expect(gate.denyCodes).toHaveLength(0);
    expect(gate.failClosedReason).toBeNull();
  });

  it("constructs evidence certificate with tamper check passed", () => {
    const cert = buildEvidenceCertificate({
      agreement: mockAgreement,
      signature: mockValidSignature,
    });
    expect(cert.signatureId).toBe("sig-2222");
    expect(cert.evidence.tamperCheckPassed).toBe(true);
    expect(cert.signer.legalName).toBe("Jane Doe");
    expect(cert.disclosures.intermediaryModel).toBe("INDEPENDENT_CONTRACTOR_MARKETPLACE");
    expect(cert.disclosures.nonWaivableRightsCarveout).toBe(true);
  });
});
