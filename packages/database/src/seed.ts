import "dotenv/config";
import { hashPassword } from "@marketplace/auth";
import {
  CANONICAL_TRADE_CATALOG,
  CANONICAL_TRADE_POLICIES,
  DEFAULT_COMPLIANCE_STANDARDS,
} from "@marketplace/vertical-engine";
import {
  db,
  pool,
  eq,
  and,
  users,
  userRoles,
  verticals,
  serviceCategories,
  issueTypes,
  properties,
  contractors,
  technicians,
  credentials,
  paymentRules,
  tradeRegulatoryPolicies,
  contractorCapabilityAssessments,
} from "./index.js";

const password = await hashPassword("DemoPassword!2026");

async function seedUser(
  email: string,
  name: string,
  role: "CUSTOMER" | "DISPATCHER" | "SUPER_ADMIN" | "CONTRACTOR_OWNER" | "TECHNICIAN" | "ADMIN",
): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing) {
    userId = existing.id;
    await db
      .update(users)
      .set({ displayName: name, passwordHash: password })
      .where(eq(users.id, userId));
  } else {
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        passwordHash: password,
        displayName: name,
      })
      .returning({ id: users.id });
    if (!inserted) throw new Error(`Failed to seed user ${email}`);
    userId = inserted.id;
  }

  await db
    .insert(userRoles)
    .values({
      userId,
      role,
    })
    .onConflictDoNothing();

  return userId;
}

const customer = await seedUser("customer@example.test", "Avery Homeowner", "CUSTOMER");
const dispatcher = await seedUser("dispatch@example.test", "Morgan Dispatch", "DISPATCHER");
const admin = await seedUser("admin@example.test", "Platform Admin", "SUPER_ADMIN");
const contractorOwner = await seedUser("owner@example.test", "Jordan Owner", "CONTRACTOR_OWNER");
const technicianUser = await seedUser("technician@example.test", "John Service", "TECHNICIAN");

// 1. Seed all 21 Canonical Trade Verticals, Categories, and Service Variants
for (const entry of CANONICAL_TRADE_CATALOG) {
  const branding = { displayName: entry.name, domain: "skilledhire.ca" };
  const tradeStandards = DEFAULT_COMPLIANCE_STANDARDS.filter(
    (s) => s.verticalSlug === entry.slug && s.active,
  );
  const credentialRequirements =
    tradeStandards.length > 0
      ? tradeStandards.map((s) => ({
          code: s.credentialCode,
          geography: s.geography,
          verificationRequired: s.requirementLevel === "MANDATORY",
        }))
      : [
          {
            code: `${entry.slug.toUpperCase().replace(/-/g, "_")}_LICENSE`,
            geography: "ON",
            verificationRequired: true,
          },
        ];
  const config = {
    branding,
    emergencyRules: [{ targetMinutes: 120, calloutFeeCents: 14900 }],
    credentialRequirements,
  };

  const [v] = await db
    .insert(verticals)
    .values({
      slug: entry.slug,
      name: entry.name,
      family: entry.family,
      description: entry.description,
      icon: entry.icon,
      riskTier: entry.riskTier,
      permitAuthority: entry.permitAuthority ?? null,
      launchReady: entry.launchReady,
      displayOrder: entry.displayOrder,
      config,
    })
    .onConflictDoUpdate({
      target: verticals.slug,
      set: {
        name: entry.name,
        family: entry.family,
        description: entry.description,
        icon: entry.icon,
        riskTier: entry.riskTier,
        permitAuthority: entry.permitAuthority ?? null,
        launchReady: entry.launchReady,
        displayOrder: entry.displayOrder,
        config,
      },
    })
    .returning({ id: verticals.id });

  if (!v) continue;

  for (const cat of entry.categories) {
    const [catRow] = await db
      .insert(serviceCategories)
      .values({
        verticalId: v.id,
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        riskTier: cat.riskTier,
        launchReady: cat.launchReady,
        displayOrder: cat.displayOrder,
      })
      .onConflictDoUpdate({
        target: [serviceCategories.verticalId, serviceCategories.slug],
        set: {
          name: cat.name,
          description: cat.description,
          riskTier: cat.riskTier,
          launchReady: cat.launchReady,
          displayOrder: cat.displayOrder,
        },
      })
      .returning({ id: serviceCategories.id });

    if (!catRow) continue;

    for (const variant of cat.variants) {
      await db
        .insert(issueTypes)
        .values({
          categoryId: catRow.id,
          slug: variant.slug,
          name: variant.name,
          description: variant.description,
          scopeSummary: variant.scopeSummary,
          riskTier: variant.riskTier,
          pricingType: variant.pricingType,
          basePriceCents: variant.basePriceCents,
          defaultDurationMinutes: variant.defaultDurationMinutes,
          requiresPermit: variant.requiresPermit,
          permitType: variant.permitType ?? null,
          requiredEvidence: variant.requiredEvidence,
          defaultWarrantyMonths: variant.defaultWarrantyMonths,
          geographicRestrictions: variant.geographicRestrictions,
          tags: variant.tags,
          equipmentFields: ["manufacturer", "model"],
          launchReady: variant.launchReady,
          displayOrder: variant.displayOrder,
        })
        .onConflictDoUpdate({
          target: [issueTypes.categoryId, issueTypes.slug],
          set: {
            name: variant.name,
            description: variant.description,
            scopeSummary: variant.scopeSummary,
            riskTier: variant.riskTier,
            pricingType: variant.pricingType,
            basePriceCents: variant.basePriceCents,
            defaultDurationMinutes: variant.defaultDurationMinutes,
            requiresPermit: variant.requiresPermit,
            permitType: variant.permitType ?? null,
            requiredEvidence: variant.requiredEvidence,
            defaultWarrantyMonths: variant.defaultWarrantyMonths,
            geographicRestrictions: variant.geographicRestrictions,
            tags: variant.tags,
            launchReady: variant.launchReady,
            displayOrder: variant.displayOrder,
          },
        });
    }
  }
}

// 2. Canonical Ontario Trade Regulatory Policies (Ticket #55)
for (const policy of CANONICAL_TRADE_POLICIES) {
  await db
    .insert(tradeRegulatoryPolicies)
    .values({
      verticalSlug: policy.verticalSlug,
      categorySlug: policy.categorySlug,
      variantSlug: policy.variantSlug,
      geography: policy.geography,
      policyVersion: policy.policyVersion,
      contractorMandatoryCodes: policy.contractorMandatoryCodes as any,
      technicianMandatoryCodes: policy.technicianMandatoryCodes as any,
      apprenticeEligible: policy.apprenticeEligible,
      supervisorRatio: policy.supervisorRatio,
      permitRequired: policy.permitRequired,
      inspectionAuthority: policy.inspectionAuthority,
      legalAuthorityDisclaimer: policy.legalAuthorityDisclaimer,
      active: policy.active,
    })
    .onConflictDoUpdate({
      target: [
        tradeRegulatoryPolicies.verticalSlug,
        tradeRegulatoryPolicies.categorySlug,
        tradeRegulatoryPolicies.variantSlug,
        tradeRegulatoryPolicies.geography,
        tradeRegulatoryPolicies.policyVersion,
      ],
      set: {
        contractorMandatoryCodes: policy.contractorMandatoryCodes as any,
        technicianMandatoryCodes: policy.technicianMandatoryCodes as any,
        apprenticeEligible: policy.apprenticeEligible,
        supervisorRatio: policy.supervisorRatio,
        permitRequired: policy.permitRequired,
        inspectionAuthority: policy.inspectionAuthority,
        legalAuthorityDisclaimer: policy.legalAuthorityDisclaimer,
        active: policy.active,
      },
    });
}

// 3. Retrieve HVAC and AC IDs for legacy seed references
const hvacRow = await db.query.verticals.findFirst({
  where: eq(verticals.slug, "hvac"),
});
if (!hvacRow) throw new Error("Missing HVAC vertical after seeding");
const vertical = hvacRow.id;

const issueCategory = await db.query.serviceCategories.findFirst({
  where: and(eq(serviceCategories.verticalId, vertical), eq(serviceCategories.slug, "cooling")),
  with: {
    issueTypes: {
      where: eq(issueTypes.slug, "ac-not-cooling"),
    },
  },
});
const issue = issueCategory?.issueTypes[0]?.id;
if (!issue) throw new Error("Missing AC issue after seeding");

// 4. Property
let prop = await db.query.properties.findFirst({
  where: and(eq(properties.customerId, customer), eq(properties.label, "My Home")),
});
if (!prop) {
  const [inserted] = await db
    .insert(properties)
    .values({
      customerId: customer,
      label: "My Home",
      addressLine1: "123 King Street W",
      city: "Toronto",
      region: "ON",
      postalCode: "M5H 1J9",
      latitude: "43.6487",
      longitude: "-79.3817",
    })
    .returning();
  prop = inserted;
}
const property = prop?.id;
if (!property) throw new Error("Missing property");

// 5. Contractor & Technician
let existingContractor = await db.query.contractors.findFirst({
  where: eq(contractors.name, "ABC Heating & Cooling"),
});
if (!existingContractor) {
  const [inserted] = await db
    .insert(contractors)
    .values({
      ownerUserId: contractorOwner,
      name: "ABC Heating & Cooling",
      status: "VERIFIED",
      ratingBps: 490,
      completionRateBps: 9700,
      avgResponseMinutes: 18,
      serviceAreas: ["Toronto"],
      verticalIds: [vertical],
    })
    .returning();
  existingContractor = inserted;
}
const contractor = existingContractor?.id;
if (!contractor) throw new Error("Missing contractor");

let existingTechnician = await db.query.technicians.findFirst({
  where: eq(technicians.userId, technicianUser),
});
if (!existingTechnician) {
  const [inserted] = await db
    .insert(technicians)
    .values({
      userId: technicianUser,
      contractorId: contractor,
      displayName: "John S.",
      active: true,
      emergencyAvailable: true,
      latitude: "43.6532",
      longitude: "-79.3832",
    })
    .returning();
  existingTechnician = inserted;
}
const technician = existingTechnician?.id;
if (!technician) throw new Error("Missing technician");

// 6. Contractor & Technician Regulatory Credentials (Ticket #55)
const contractorCredCodes = [
  { code: "ON_TSSA_CONTRACTOR_REG", ref: "TSSA-FS-CONT-440192" },
  { code: "ON_WSIB_CLEARANCE", ref: "WSIB-ON-9938102" },
  { code: "CGL_INSURANCE_2M", ref: "POLICY-AVIVA-883910" },
  { code: "COMMERCIAL_AUTO_1M", ref: "POLICY-INTACT-119283" },
];
for (const { code, ref } of contractorCredCodes) {
  const existing = await db.query.credentials.findFirst({
    where: and(eq(credentials.contractorId, contractor), eq(credentials.code, code)),
  });
  if (!existing) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    await db.insert(credentials).values({
      contractorId: contractor,
      code,
      geography: "ON",
      status: "VERIFIED",
      verificationSource: "REGULATOR_API",
      regulatorReference: ref,
      checkedAt: new Date(),
      verifiedAt: new Date(),
      expiryDate: expiry.toISOString().split("T")[0]!,
    });
  }
}

const techCredCodes = [
  { code: "HVAC_LICENSE", ref: "TSSA-G2-883921" },
  { code: "ON_TSSA_GAS_G2", ref: "TSSA-G2-883921" },
  { code: "ON_SKILLED_TRADES_313A", ref: "STO-313A-559102" },
  { code: "CA_ODS_REFRIGERANT", ref: "HRAI-ODS-99211" },
  { code: "ON_MOL_HEIGHTS", ref: "CPO-WAH-882910" },
  { code: "GOVT_PHOTO_ID", ref: "ON-DL-S1928-33829-19283" },
  { code: "BACKGROUND_CHECK_ANNUAL", ref: "CERTI-CLEAR-2026-99" },
];
for (const { code, ref } of techCredCodes) {
  const existing = await db.query.credentials.findFirst({
    where: and(eq(credentials.technicianId, technician), eq(credentials.code, code)),
  });
  if (!existing) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    await db.insert(credentials).values({
      technicianId: technician,
      code,
      geography: "ON",
      status: "VERIFIED",
      verificationSource: "REGULATOR_API",
      regulatorReference: ref,
      checkedAt: new Date(),
      verifiedAt: new Date(),
      expiryDate: expiry.toISOString().split("T")[0]!,
    });
  }
}

// 7. Payment Rules
const existingPaymentRule = await db.query.paymentRules.findFirst({
  where: and(eq(paymentRules.verticalId, vertical), eq(paymentRules.minAmountCents, 0)),
});
if (!existingPaymentRule) {
  await db.insert(paymentRules).values({
    verticalId: vertical,
    minAmountCents: 0,
    maxAmountCents: null,
    rule: {
      milestones: [
        {
          trigger: "QUOTE_APPROVED",
          percentageBps: 2000,
          evidenceRequired: false,
        },
        {
          trigger: "CUSTOMER_ACCEPTED",
          percentageBps: 8000,
          evidenceRequired: true,
        },
      ],
    },
  });
}

// 7b. Contractor Technical Capability Assessment (Ticket #56 / #57)
const existingCapability = await db.query.contractorCapabilityAssessments.findFirst({
  where: and(
    eq(contractorCapabilityAssessments.contractorId, contractor),
    eq(contractorCapabilityAssessments.issueTypeId, issue),
    eq(contractorCapabilityAssessments.geography, "ON"),
  ),
});
if (!existingCapability) {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 2);
  await db.insert(contractorCapabilityAssessments).values({
    contractorId: contractor,
    issueTypeId: issue,
    geography: "ON",
    status: "APPROVED",
    complexityTier: "TIER_1_BASIC",
    yearsExperience: 10,
    maxJobValueCents: 500000,
    assessedByUserId: admin,
    assessedAt: new Date(),
    validUntil: expiry,
    decisionNotes: "Verified HVAC technical competency during platform onboarding",
  });
}

// 8. Fixtures for dispatch and discovery testing
for (const fixture of [
  {
    ownerEmail: "north-owner@example.test",
    technicianEmail: "north-tech@example.test",
    company: "North Star Mechanical",
    technicianName: "Priya R.",
    rating: 480,
  },
  {
    ownerEmail: "city-owner@example.test",
    technicianEmail: "city-tech@example.test",
    company: "City Comfort Services",
    technicianName: "Mateo L.",
    rating: 470,
  },
] as const) {
  const owner = await seedUser(
    fixture.ownerEmail,
    `${fixture.company} Owner`,
    "CONTRACTOR_OWNER",
  );
  const techUser = await seedUser(
    fixture.technicianEmail,
    fixture.technicianName,
    "TECHNICIAN",
  );

  let comp = await db.query.contractors.findFirst({
    where: eq(contractors.name, fixture.company),
  });
  if (!comp) {
    const [inserted] = await db
      .insert(contractors)
      .values({
        ownerUserId: owner,
        name: fixture.company,
        status: "VERIFIED",
        ratingBps: fixture.rating,
        completionRateBps: 9600,
        avgResponseMinutes: 25,
        serviceAreas: ["Toronto"],
        verticalIds: [vertical],
      })
      .returning();
    comp = inserted;
  }
  const companyId = comp?.id;
  if (!companyId) throw new Error("Missing fixture contractor");

  let t = await db.query.technicians.findFirst({
    where: eq(technicians.userId, techUser),
  });
  if (!t) {
    const [inserted] = await db
      .insert(technicians)
      .values({
        userId: techUser,
        contractorId: companyId,
        displayName: fixture.technicianName,
        active: true,
        emergencyAvailable: true,
        latitude: "43.65",
        longitude: "-79.39",
      })
      .returning();
    t = inserted;
  }
  const techId = t?.id;
  if (!techId) throw new Error("Missing fixture technician");

  for (const { code, ref } of contractorCredCodes) {
    const existing = await db.query.credentials.findFirst({
      where: and(eq(credentials.contractorId, companyId), eq(credentials.code, code)),
    });
    if (!existing) {
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      await db.insert(credentials).values({
        contractorId: companyId,
        code,
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: `${ref}-${companyId.slice(0, 4)}`,
        checkedAt: new Date(),
        verifiedAt: new Date(),
        expiryDate: expiry.toISOString().split("T")[0]!,
      });
    }
  }

  for (const { code, ref } of techCredCodes) {
    const existing = await db.query.credentials.findFirst({
      where: and(eq(credentials.technicianId, techId), eq(credentials.code, code)),
    });
    if (!existing) {
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      await db.insert(credentials).values({
        technicianId: techId,
        code,
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: `${ref}-${techId.slice(0, 4)}`,
        checkedAt: new Date(),
        verifiedAt: new Date(),
        expiryDate: expiry.toISOString().split("T")[0]!,
      });
    }
  }

  const existingFixtureCap = await db.query.contractorCapabilityAssessments.findFirst({
    where: and(
      eq(contractorCapabilityAssessments.contractorId, companyId),
      eq(contractorCapabilityAssessments.issueTypeId, issue),
      eq(contractorCapabilityAssessments.geography, "ON"),
    ),
  });
  if (!existingFixtureCap) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    await db.insert(contractorCapabilityAssessments).values({
      contractorId: companyId,
      issueTypeId: issue,
      geography: "ON",
      status: "APPROVED",
      complexityTier: "TIER_1_BASIC",
      yearsExperience: 5,
      maxJobValueCents: 500000,
      assessedByUserId: admin,
      assessedAt: new Date(),
      validUntil: expiry,
      decisionNotes: "Fixture contractor capability verified",
    });
  }
}

console.log("Seeded with Drizzle ORM. Demo password: DemoPassword!2026");
console.log({
  customer: "customer@example.test",
  dispatcher: "dispatch@example.test",
  technician: "technician@example.test",
  admin: "admin@example.test",
  verticalId: vertical,
  issueId: issue,
  propertyId: property,
  technicianId: technician,
  dispatcherId: dispatcher,
});

await pool.end();
