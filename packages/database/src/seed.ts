import "dotenv/config";
import { hashPassword } from "@marketplace/auth";
import { CANONICAL_TRADE_CATALOG } from "@marketplace/vertical-engine";
import { pool } from "./index.js";

const password = await hashPassword("DemoPassword!2026");
async function user(
  email: string,
  name: string,
  role: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id",
    [email, password, name],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Failed to seed user");
  await pool.query(
    "INSERT INTO user_roles(user_id,role) VALUES($1,$2::user_role) ON CONFLICT DO NOTHING",
    [id, role],
  );
  return id;
}
const customer = await user(
  "customer@example.test",
  "Avery Homeowner",
  "CUSTOMER",
);
const dispatcher = await user(
  "dispatch@example.test",
  "Morgan Dispatch",
  "DISPATCHER",
);
await user("admin@example.test", "Platform Admin", "SUPER_ADMIN");
const contractorOwner = await user(
  "owner@example.test",
  "Jordan Owner",
  "CONTRACTOR_OWNER",
);
const technicianUser = await user(
  "technician@example.test",
  "John Service",
  "TECHNICIAN",
);

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
  const vRes = await pool.query<{ id: string }>(
    `INSERT INTO verticals(slug, name, family, description, icon, risk_tier, permit_authority, launch_ready, display_order, config)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(slug) DO UPDATE SET
       name = EXCLUDED.name,
       family = EXCLUDED.family,
       description = EXCLUDED.description,
       icon = EXCLUDED.icon,
       risk_tier = EXCLUDED.risk_tier,
       permit_authority = EXCLUDED.permit_authority,
       launch_ready = EXCLUDED.launch_ready,
       display_order = EXCLUDED.display_order
     RETURNING id`,
    [
      entry.slug,
      entry.name,
      entry.family,
      entry.description,
      entry.icon,
      entry.riskTier,
      entry.permitAuthority ?? null,
      entry.launchReady,
      entry.displayOrder,
      JSON.stringify(config),
    ],
  );
  const vId = vRes.rows[0]?.id;
  if (!vId) continue;

  for (const cat of entry.categories) {
    const catRes = await pool.query<{ id: string }>(
      `INSERT INTO service_categories(vertical_id, slug, name, description, risk_tier, launch_ready, display_order)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(vertical_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         risk_tier = EXCLUDED.risk_tier,
         launch_ready = EXCLUDED.launch_ready,
         display_order = EXCLUDED.display_order
       RETURNING id`,
      [
        vId,
        cat.slug,
        cat.name,
        cat.description,
        cat.riskTier,
        cat.launchReady,
        cat.displayOrder,
      ],
    );
    const catId = catRes.rows[0]?.id;
    if (!catId) continue;

    for (const v of cat.variants) {
      await pool.query(
        `INSERT INTO issue_types(
           category_id, slug, name, description, scope_summary, risk_tier, pricing_type,
           base_price_cents, default_duration_minutes, requires_permit, permit_type,
           required_evidence, default_warranty_months, geographic_restrictions, tags, launch_ready, display_order, equipment_fields
         )
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, '["manufacturer","model"]')
         ON CONFLICT(category_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           scope_summary = EXCLUDED.scope_summary,
           risk_tier = EXCLUDED.risk_tier,
           pricing_type = EXCLUDED.pricing_type,
           base_price_cents = EXCLUDED.base_price_cents,
           default_duration_minutes = EXCLUDED.default_duration_minutes,
           requires_permit = EXCLUDED.requires_permit,
           permit_type = EXCLUDED.permit_type,
           required_evidence = EXCLUDED.required_evidence,
           default_warranty_months = EXCLUDED.default_warranty_months,
           geographic_restrictions = EXCLUDED.geographic_restrictions,
           tags = EXCLUDED.tags,
           launch_ready = EXCLUDED.launch_ready,
           display_order = EXCLUDED.display_order`,
        [
          catId,
          v.slug,
          v.name,
          v.description,
          v.scopeSummary,
          v.riskTier,
          v.pricingType,
          v.basePriceCents,
          v.defaultDurationMinutes,
          v.requiresPermit,
          v.permitType ?? null,
          JSON.stringify(v.requiredEvidence),
          v.defaultWarrantyMonths,
          JSON.stringify(v.geographicRestrictions),
          JSON.stringify(v.tags),
          v.launchReady,
          v.displayOrder,
        ],
      );
    }
  }
}

// Retrieve HVAC and AC IDs for legacy seed references
const hvacRow = await pool.query<{ id: string }>(
  "SELECT id FROM verticals WHERE slug='hvac'",
);
const vertical = hvacRow.rows[0]?.id;
if (!vertical) throw new Error("Missing HVAC vertical after seeding");
const issueRow = await pool.query<{ id: string }>(
  "SELECT i.id FROM issue_types i JOIN service_categories c ON c.id=i.category_id WHERE c.slug='cooling' AND i.slug='ac-not-cooling'",
);
const issue = issueRow.rows[0]?.id;
if (!issue) throw new Error("Missing AC issue after seeding");
const existingProperty = await pool.query<{ id: string }>(
  "SELECT id FROM properties WHERE customer_id=$1 AND label='My Home' LIMIT 1",
  [customer],
);
const property =
  existingProperty.rows[0]?.id ??
  (
    await pool.query<{ id: string }>(
      "INSERT INTO properties(customer_id,label,address_line1,city,region,postal_code,latitude,longitude) VALUES($1,'My Home','123 King Street W','Toronto','ON','M5H 1J9',43.6487,-79.3817) RETURNING id",
      [customer],
    )
  ).rows[0]?.id;
if (!property) throw new Error("Missing property");
const existingContractor = await pool.query<{ id: string }>(
  "SELECT id FROM contractors WHERE name='ABC Heating & Cooling' LIMIT 1",
);
const contractor =
  existingContractor.rows[0]?.id ??
  (
    await pool.query<{ id: string }>(
      "INSERT INTO contractors(owner_user_id,name,status,rating_bps,completion_rate_bps,avg_response_minutes,service_areas,vertical_ids) VALUES($1,'ABC Heating & Cooling','VERIFIED',490,9700,18,'[\"Toronto\"]',$2) RETURNING id",
      [contractorOwner, JSON.stringify([vertical])],
    )
  ).rows[0]?.id;
if (!contractor) throw new Error("Missing contractor");
const existingTechnician = await pool.query<{ id: string }>(
  "SELECT id FROM technicians WHERE user_id=$1",
  [technicianUser],
);
const technician =
  existingTechnician.rows[0]?.id ??
  (
    await pool.query<{ id: string }>(
      "INSERT INTO technicians(user_id,contractor_id,display_name,active,emergency_available,latitude,longitude) VALUES($1,$2,'John S.',true,true,43.6532,-79.3832) RETURNING id",
      [technicianUser, contractor],
    )
  ).rows[0]?.id;
if (!technician) throw new Error("Missing technician");
await pool.query(
  "INSERT INTO credentials(technician_id,code,geography,status,expiry_date,verified_at) SELECT $1,'HVAC_LICENSE','ON','VERIFIED',current_date + interval '365 days',now() WHERE NOT EXISTS (SELECT 1 FROM credentials WHERE technician_id=$1 AND code='HVAC_LICENSE')",
  [technician],
);
await pool.query(
  "INSERT INTO payment_rules(vertical_id,min_amount_cents,max_amount_cents,rule) SELECT $1,0,NULL,$2 WHERE NOT EXISTS (SELECT 1 FROM payment_rules WHERE vertical_id=$1 AND min_amount_cents=0 AND max_amount_cents IS NULL)",
  [
    vertical,
    JSON.stringify({
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
    }),
  ],
);
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
  const owner = await user(
    fixture.ownerEmail,
    `${fixture.company} Owner`,
    "CONTRACTOR_OWNER",
  );
  const techUser = await user(
    fixture.technicianEmail,
    fixture.technicianName,
    "TECHNICIAN",
  );
  const existingCompany = await pool.query<{ id: string }>(
    "SELECT id FROM contractors WHERE name=$1 LIMIT 1",
    [fixture.company],
  );
  const companyId =
    existingCompany.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "INSERT INTO contractors(owner_user_id,name,status,rating_bps,completion_rate_bps,avg_response_minutes,service_areas,vertical_ids) VALUES($1,$2,'VERIFIED',$3,9600,25,'[\"Toronto\"]',$4) RETURNING id",
        [owner, fixture.company, fixture.rating, JSON.stringify([vertical])],
      )
    ).rows[0]?.id;
  if (!companyId) throw new Error("Missing fixture contractor");
  const existingTech = await pool.query<{ id: string }>(
    "SELECT id FROM technicians WHERE user_id=$1",
    [techUser],
  );
  const techId =
    existingTech.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "INSERT INTO technicians(user_id,contractor_id,display_name,active,emergency_available,latitude,longitude) VALUES($1,$2,$3,true,true,43.65,-79.39) RETURNING id",
        [techUser, companyId, fixture.technicianName],
      )
    ).rows[0]?.id;
  if (!techId) throw new Error("Missing fixture technician");
  await pool.query(
    "INSERT INTO credentials(technician_id,code,geography,status,expiry_date,verified_at) SELECT $1,'HVAC_LICENSE','ON','VERIFIED',current_date + interval '365 days',now() WHERE NOT EXISTS (SELECT 1 FROM credentials WHERE technician_id=$1 AND code='HVAC_LICENSE')",
    [techId],
  );
}
console.log("Seeded. Demo password: DemoPassword!2026");
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
