import "dotenv/config";
import { hashPassword } from "@marketplace/auth";
import { CANONICAL_TRADE_CATALOG } from "@marketplace/vertical-engine";
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
await seedUser("admin@example.test", "Platform Admin", "SUPER_ADMIN");
const contractorOwner = await seedUser("owner@example.test", "Jordan Owner", "CONTRACTOR_OWNER");
const technicianUser = await seedUser("technician@example.test", "John Service", "TECHNICIAN");

// 1. Seed all 21 Canonical Trade Verticals, Categories, and Service Variants
for (const entry of CANONICAL_TRADE_CATALOG) {
  const branding = { displayName: entry.name, domain: "skilledhire.ca" };
  const config = {
    branding,
    emergencyRules: [{ targetMinutes: 120, calloutFeeCents: 14900 }],
    credentialRequirements: [
      {
        code: `${entry.slug.toUpperCase()}_LICENSE`,
        geography: "ON",
        verificationRequired: true,
      },
    ],
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
const CANONICAL_REGULATORY_POLICIES = [
  {
    verticalSlug: "electrical",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_ESA_LEC_CONTRACTOR", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_SKILLED_TRADES_309A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: true,
    inspectionAuthority: "Electrical Safety Authority (ESA / ECRA)",
    legalAuthorityDisclaimer: "Electricity Act, 1998, O.Reg 570/05 requires all electrical work to be performed by an ECRA/ESA Licensed Electrical Contractor employing qualified 309A certified electricians or registered apprentices.",
  },
  {
    verticalSlug: "plumbing",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_SKILLED_TRADES_306A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Municipal Building / Plumbing Inspection",
    legalAuthorityDisclaimer: "Ontario Building Code Part 7 and Building Opportunities in the Skilled Trades Act (BOSTA) require certified 306A plumbers for water supply and drainage systems.",
  },
  {
    verticalSlug: "hvac",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_TSSA_CONTRACTOR_REG", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_TSSA_GAS_G2", "ON_SKILLED_TRADES_313A", "CA_ODS_REFRIGERANT", "ON_MOL_HEIGHTS", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: false,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Technical Standards and Safety Authority (TSSA)",
    legalAuthorityDisclaimer: "Technical Standards and Safety Act, O.Reg 215/01 mandates TSSA contractor registration and individual G2/G1 Gas Technician plus 313A certification for fuel and refrigerant equipment.",
  },
  {
    verticalSlug: "roofing",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["CGL_INSURANCE_2M", "ON_WSIB_CLEARANCE", "ROOFING_OPEN_FLAME_INSURANCE"],
    technicianMandatoryCodes: ["ON_MOL_HEIGHTS", "ROOFING_FALL_PROTECTION", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:2",
    permitRequired: false,
    inspectionAuthority: "Ministry of Labour CPO Working at Heights",
    legalAuthorityDisclaimer: "Occupational Health and Safety Act, O.Reg 297/13 mandates CPO-approved working at heights training for all roofing and elevated operations.",
  },
];

for (const policy of CANONICAL_REGULATORY_POLICIES) {
  await db
    .insert(tradeRegulatoryPolicies)
    .values(policy)
    .onConflictDoUpdate({
      target: [
        tradeRegulatoryPolicies.verticalSlug,
        tradeRegulatoryPolicies.categorySlug,
        tradeRegulatoryPolicies.variantSlug,
        tradeRegulatoryPolicies.geography,
        tradeRegulatoryPolicies.policyVersion,
      ],
      set: {
        contractorMandatoryCodes: policy.contractorMandatoryCodes,
        technicianMandatoryCodes: policy.technicianMandatoryCodes,
        apprenticeEligible: policy.apprenticeEligible,
        supervisorRatio: policy.supervisorRatio,
        permitRequired: policy.permitRequired,
        inspectionAuthority: policy.inspectionAuthority,
        legalAuthorityDisclaimer: policy.legalAuthorityDisclaimer,
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

// 6. Technician Credentials (with fail-closed authoritative regulator verification)
const existingCred = await db.query.credentials.findFirst({
  where: and(eq(credentials.technicianId, technician), eq(credentials.code, "HVAC_LICENSE")),
});
if (!existingCred) {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  await db.insert(credentials).values({
    technicianId: technician,
    code: "HVAC_LICENSE",
    geography: "ON",
    status: "VERIFIED",
    verificationSource: "REGULATOR_API",
    regulatorReference: "TSSA-G2-883921",
    checkedAt: new Date(),
    verifiedAt: new Date(),
    expiryDate: expiry.toISOString().split("T")[0]!,
  });
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

  const existingFixtureCred = await db.query.credentials.findFirst({
    where: and(eq(credentials.technicianId, techId), eq(credentials.code, "HVAC_LICENSE")),
  });
  if (!existingFixtureCred) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    await db.insert(credentials).values({
      technicianId: techId,
      code: "HVAC_LICENSE",
      geography: "ON",
      status: "VERIFIED",
      verificationSource: "REGULATOR_API",
      regulatorReference: `TSSA-${techId.slice(0, 8)}`,
      checkedAt: new Date(),
      verifiedAt: new Date(),
      expiryDate: expiry.toISOString().split("T")[0]!,
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
