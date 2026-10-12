import type {
  AgreementSignatureRecord,
  LegalAgreementRecord,
  SignatureEvidenceCertificate,
} from "@marketplace/contracts";

function sha256Sync(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const newLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const words = new Uint32Array(newLen >> 2);

  for (let i = 0; i < bytes.length; i++) {
    const wIdx = i >> 2;
    words[wIdx] =
      (words[wIdx] ?? 0) | ((bytes[i] ?? 0) << (24 - (i % 4) * 8));
  }
  const endIdx = bytes.length >> 2;
  words[endIdx] =
    (words[endIdx] ?? 0) | (0x80 << (24 - (bytes.length % 4) * 8));
  words[words.length - 1] = bitLen;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) {
      w[t] = words[i + t]!;
    }
    for (let t = 16; t < 64; t++) {
      const s0 =
        rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 =
        rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Computes deterministic SHA-256 checksum for agreement markdown text.
 */
export function computeAgreementChecksum(contentMarkdown: string): string {
  return sha256Sync(contentMarkdown.trim());
}

/**
 * Verifies that a signed agreement record matches the active agreement content and has not been tampered with or revoked.
 */
export function verifySignatureEvidence(params: {
  agreement: LegalAgreementRecord;
  signature: AgreementSignatureRecord;
}): { valid: boolean; reason?: string } {
  const { agreement, signature } = params;

  if (signature.revokedAt) {
    return { valid: false, reason: "Signature has been revoked" };
  }

  if (signature.agreementId !== agreement.id) {
    return {
      valid: false,
      reason: `Signature agreementId mismatch: expected ${agreement.id}, received ${signature.agreementId}`,
    };
  }

  if (signature.agreementVersion !== agreement.version) {
    return {
      valid: false,
      reason: `Signature version mismatch: expected ${agreement.version}, received ${signature.agreementVersion}`,
    };
  }

  if (signature.agreementChecksum !== agreement.contentChecksum) {
    return {
      valid: false,
      reason: `Signature checksum mismatch: expected ${agreement.contentChecksum}, received ${signature.agreementChecksum}`,
    };
  }

  return { valid: true };
}

/**
 * Evaluates the legal dispatch gates for marketplace role and independent contractor agreement compliance.
 * Fails closed if the contractor has not signed the active ICA or if customer terms are unaccepted.
 */
export function evaluateLegalDispatchGate(params: {
  contractorAgreement: LegalAgreementRecord;
  contractorSignature: AgreementSignatureRecord | null;
  customerAgreement?: LegalAgreementRecord | null;
  customerSignature?: AgreementSignatureRecord | null;
}): {
  canDispatch: boolean;
  denyCodes: string[];
  failClosedReason?: string | null;
} {
  const denyCodes: string[] = [];
  const reasons: string[] = [];

  // 1. Contractor ICA compliance check
  if (!params.contractorSignature) {
    denyCodes.push("CONTRACTOR_AGREEMENT_REQUIRED");
    reasons.push(
      `Contractor has not signed active Independent Contractor Agreement (v${params.contractorAgreement.version})`,
    );
  } else {
    const verification = verifySignatureEvidence({
      agreement: params.contractorAgreement,
      signature: params.contractorSignature,
    });
    if (!verification.valid) {
      denyCodes.push("CONTRACTOR_AGREEMENT_INVALID");
      reasons.push(
        `Contractor signature invalid or outdated: ${verification.reason}`,
      );
    }
  }

  // 2. Customer terms acceptance check (if customer agreement provided)
  if (params.customerAgreement) {
    if (!params.customerSignature) {
      denyCodes.push("CUSTOMER_TERMS_REQUIRED");
      reasons.push(
        `Customer has not accepted active Customer Service Terms (v${params.customerAgreement.version})`,
      );
    } else {
      const custVerification = verifySignatureEvidence({
        agreement: params.customerAgreement,
        signature: params.customerSignature,
      });
      if (!custVerification.valid) {
        denyCodes.push("CUSTOMER_TERMS_INVALID");
        reasons.push(
          `Customer signature invalid or outdated: ${custVerification.reason}`,
        );
      }
    }
  }

  if (denyCodes.length > 0) {
    return {
      canDispatch: false,
      denyCodes,
      failClosedReason: reasons.join("; "),
    };
  }

  return {
    canDispatch: true,
    denyCodes: [],
    failClosedReason: null,
  };
}

/**
 * Builds a structured, tamper-evident certificate for e-signature auditing and dispute proceedings.
 */
export function buildEvidenceCertificate(params: {
  agreement: LegalAgreementRecord;
  signature: AgreementSignatureRecord;
}): SignatureEvidenceCertificate {
  const verification = verifySignatureEvidence(params);

  return {
    certificateId: `CERT-${params.signature.id.slice(0, 8).toUpperCase()}-${Date.now()}`,
    signatureId: params.signature.id,
    agreement: {
      id: params.agreement.id,
      type: params.agreement.type,
      version: params.agreement.version,
      jurisdiction: params.agreement.jurisdiction,
      title: params.agreement.title,
      legalCounselRef: params.agreement.legalCounselRef ?? null,
      contentChecksum: params.agreement.contentChecksum,
    },
    signer: {
      userId: params.signature.signerUserId,
      legalName: params.signature.signerLegalName,
      role: params.signature.signerRole,
      title: params.signature.signerTitle ?? null,
      entityType: params.signature.entityType,
      contractorId: params.signature.contractorId ?? null,
    },
    evidence: {
      signedAt: params.signature.signedAt,
      ipAddress: params.signature.ipAddress,
      userAgent: params.signature.userAgent,
      agreementChecksum: params.signature.agreementChecksum,
      tamperCheckPassed: verification.valid,
    },
    disclosures: {
      intermediaryModel:
        String(params.agreement.keyTerms.intermediaryModel ?? "INDEPENDENT_CONTRACTOR_MARKETPLACE"),
      governingLaw: String(params.agreement.keyTerms.governingLaw ?? "ONTARIO_CANADA"),
      nonWaivableRightsCarveout: Boolean(
        params.agreement.keyTerms.nonWaivableRightsProtected ??
          params.agreement.keyTerms.consumerProtectionActCompliant ??
          true,
      ),
    },
  };
}
