import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  filterComplianceStandards,
  selectPaymentRule,
} from "./index.js";

describe("payment rule selection", () => {
  it("requires a balanced matching rule", () => {
    expect(
      selectPaymentRule(
        [
          {
            id: "r",
            verticalId: "v",
            minAmountCents: 0,
            maxAmountCents: null,
            milestones: [
              {
                trigger: "COMPLETE",
                percentageBps: 10000,
                evidenceRequired: false,
              },
            ],
          },
        ],
        "v",
        100,
      ),
    ).toMatchObject({ id: "r" });
  });
});

describe("compliance standards registry & verification", () => {
  it("exports the 6 canonical regulatory groups", () => {
    expect(CREDENTIAL_GROUPS).toHaveLength(6);
    const codes = CREDENTIAL_GROUPS.map((g) => g.code);
    expect(codes).toContain("TRADE_LICENSING");
    expect(codes).toContain("ENVIRONMENTAL_HAZARDOUS");
    expect(codes).toContain("INSURANCE_FINANCIAL");
    expect(codes).toContain("HEALTH_SAFETY");
    expect(codes).toContain("STATUTORY_REGISTRATION");
    expect(codes).toContain("TRUST_IDENTITY");
  });

  it("filters standards accurately by vertical and geography", () => {
    const ontarioHvac = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "ON",
    );
    expect(ontarioHvac.some((s) => s.credentialCode === "ON_TSSA_GAS_G2")).toBe(
      true,
    );
    expect(
      ontarioHvac.some((s) => s.credentialCode === "ON_WSIB_CLEARANCE"),
    ).toBe(true);
    expect(
      ontarioHvac.some((s) => s.credentialCode === "CGL_INSURANCE_2M"),
    ).toBe(true); // universal
    // California specific should NOT be in Ontario list
    expect(ontarioHvac.some((s) => s.credentialCode === "CA_CSLB_C20")).toBe(
      false,
    );

    const californiaHvac = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "CA",
    );
    expect(californiaHvac.some((s) => s.credentialCode === "CA_CSLB_C20")).toBe(
      true,
    );
    expect(
      californiaHvac.some((s) => s.credentialCode === "CA_CSLB_SURETY_BOND"),
    ).toBe(true);
    expect(
      californiaHvac.some((s) => s.credentialCode === "ON_TSSA_GAS_G2"),
    ).toBe(false);
  });

  it("evaluates a compliant contractor/technician as VERIFIED", () => {
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "ON",
      "TECHNICIAN",
    );
    const futureDate = "2028-12-31";
    const credentials = [
      {
        code: "ON_TSSA_GAS_G2",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
      {
        code: "ON_SKILLED_TRADES_313A",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
      {
        code: "CA_ODS_REFRIGERANT",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
      {
        code: "ON_MOL_HEIGHTS",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
      { code: "GOVT_PHOTO_ID", status: "VERIFIED" as const },
      {
        code: "BACKGROUND_CHECK_ANNUAL",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
      {
        code: "FIRST_AID_CPR_C",
        status: "VERIFIED" as const,
        expiryDate: futureDate,
      },
    ];

    const scorecard = evaluateCompliance(applicable, credentials, {
      verticalSlug: "hvac",
      geography: "ON",
      entityLevel: "TECHNICIAN",
      asOfDate: new Date("2026-10-09"),
    });

    expect(scorecard.overallStatus).toBe("VERIFIED");
    expect(scorecard.missingMandatoryCodes).toHaveLength(0);
    expect(scorecard.mandatoryPassed).toBe(scorecard.mandatoryTotal);
    expect(scorecard.scoreBps).toBe(10000);
  });

  it("identifies missing mandatory credentials and marks status as DEFICIENT", () => {
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "CA",
      "CONTRACTOR",
    );
    // Only submitting CGL, missing CSLB C-20 and Surety Bond
    const credentials = [
      {
        code: "CGL_INSURANCE_2M",
        status: "VERIFIED" as const,
        expiryDate: "2028-01-01",
      },
    ];

    const scorecard = evaluateCompliance(applicable, credentials, {
      verticalSlug: "hvac",
      geography: "CA",
      entityLevel: "CONTRACTOR",
      asOfDate: new Date("2026-10-09"),
    });

    expect(scorecard.overallStatus).toBe("DEFICIENT");
    expect(scorecard.missingMandatoryCodes).toContain("CA_CSLB_C20");
    expect(scorecard.missingMandatoryCodes).toContain("CA_CSLB_SURETY_BOND");
    expect(scorecard.actionItems.length).toBeGreaterThan(0);
  });

  it("identifies expired credentials and marks status as EXPIRED", () => {
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "TX",
      "CONTRACTOR",
    );
    const credentials = [
      {
        code: "TX_TDLR_ACR_CLASS_A",
        status: "VERIFIED" as const,
        expiryDate: "2024-01-01",
      }, // Expired!
      {
        code: "TX_TDLR_INSURANCE",
        status: "VERIFIED" as const,
        expiryDate: "2028-01-01",
      },
      {
        code: "CGL_INSURANCE_2M",
        status: "VERIFIED" as const,
        expiryDate: "2028-01-01",
      },
      {
        code: "COMMERCIAL_AUTO_1M",
        status: "VERIFIED" as const,
        expiryDate: "2028-01-01",
      },
    ];

    const scorecard = evaluateCompliance(applicable, credentials, {
      verticalSlug: "hvac",
      geography: "TX",
      entityLevel: "CONTRACTOR",
      asOfDate: new Date("2026-10-09"),
    });

    expect(scorecard.overallStatus).toBe("EXPIRED");
    expect(scorecard.missingMandatoryCodes).toContain("TX_TDLR_ACR_CLASS_A");
    expect(scorecard.actionItems.some((a) => a.includes("Renew expired"))).toBe(
      true,
    );
  });

  it("marks status as PENDING_REVIEW when credentials are submitted but awaiting audit", () => {
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      "hvac",
      "ON",
      "CONTRACTOR",
    );
    const credentials = [
      {
        code: "ON_TSSA_CONTRACTOR_REG",
        status: "PENDING" as const,
        documentKey: "docs/tssa.pdf",
      },
      {
        code: "ON_WSIB_CLEARANCE",
        status: "PENDING" as const,
        documentKey: "docs/wsib.pdf",
      },
      {
        code: "CGL_INSURANCE_2M",
        status: "PENDING" as const,
        documentKey: "docs/cgl.pdf",
      },
      {
        code: "COMMERCIAL_AUTO_1M",
        status: "PENDING" as const,
        documentKey: "docs/auto.pdf",
      },
    ];

    const scorecard = evaluateCompliance(applicable, credentials, {
      verticalSlug: "hvac",
      geography: "ON",
      entityLevel: "CONTRACTOR",
      asOfDate: new Date("2026-10-09"),
    });

    expect(scorecard.overallStatus).toBe("PENDING_REVIEW");
  });
});

describe("canonical trade catalog & search algorithm", () => {
  it("exports all 21 canonical trade domains with categories and variants", async () => {
    const { CANONICAL_TRADE_CATALOG } = await import("./catalog.js");
    expect(CANONICAL_TRADE_CATALOG).toHaveLength(21);

    const slugs = CANONICAL_TRADE_CATALOG.map((v) => v.slug);
    expect(slugs).toContain("hvac");
    expect(slugs).toContain("plumbing");
    expect(slugs).toContain("electrical");
    expect(slugs).toContain("roofing");
    expect(slugs).toContain("windows-doors");
    expect(slugs).toContain("carpentry");
    expect(slugs).toContain("kitchen-bath");
    expect(slugs).toContain("basement-finishing");
    expect(slugs).toContain("structural-renovations");
    expect(slugs).toContain("side-entrances-walkouts");
    expect(slugs).toContain("driveways-paving");
    expect(slugs).toContain("interlocking-masonry");
    expect(slugs).toContain("landscaping");
    expect(slugs).toContain("cleaning");
    expect(slugs).toContain("painting");
    expect(slugs).toContain("pest-wildlife");
    expect(slugs).toContain("appliance-repair");
    expect(slugs).toContain("security-smart-home");
    expect(slugs).toContain("waterproofing");
    expect(slugs).toContain("moving-junk-removal");
    expect(slugs).toContain("seasonal-services");
  });

  it("accurately ranks and filters search results across keywords, tags, and families", async () => {
    const { CANONICAL_TRADE_CATALOG, searchCatalog } =
      await import("./catalog.js");

    // Search for "panel" (electrical)
    const panelResults = searchCatalog(CANONICAL_TRADE_CATALOG, "panel");
    expect(panelResults.length).toBeGreaterThan(0);
    expect(panelResults[0]?.verticalSlug).toBe("electrical");
    expect(panelResults[0]?.requiresPermit).toBe(true);

    // Search for "leak" (roofing and plumbing)
    const leakResults = searchCatalog(CANONICAL_TRADE_CATALOG, "leak");
    expect(leakResults.length).toBeGreaterThan(0);
    const verticalsFound = new Set(leakResults.map((r) => r.verticalSlug));
    expect(
      verticalsFound.has("roofing") ||
        verticalsFound.has("plumbing") ||
        verticalsFound.has("waterproofing"),
    ).toBe(true);

    // Filter by family "MECHANICAL"
    const mechanicalResults = searchCatalog(CANONICAL_TRADE_CATALOG, "", {
      family: "MECHANICAL",
    });
    expect(
      mechanicalResults.every((r) => r.verticalFamily === "MECHANICAL"),
    ).toBe(true);
    expect(mechanicalResults.length).toBeGreaterThan(0);

    // Filter by maximum risk tier "LOW"
    const lowRiskResults = searchCatalog(CANONICAL_TRADE_CATALOG, "", {
      maxRiskTier: "LOW",
    });
    expect(lowRiskResults.every((r) => r.riskTier === "LOW")).toBe(true);
  });
});
