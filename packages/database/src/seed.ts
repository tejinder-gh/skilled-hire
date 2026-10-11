import "dotenv/config";
import { hashPassword } from "@marketplace/auth";
import { pool } from "./index.js";

const password = await hashPassword("DemoPassword!2026");
async function user(email: string, name: string, role: string): Promise<string> {
  const result = await pool.query<{ id: string }>("INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id", [email, password, name]);
  const id = result.rows[0]?.id; if (!id) throw new Error("Failed to seed user");
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2::user_role) ON CONFLICT DO NOTHING", [id, role]); return id;
}
const customer = await user("customer@example.test", "Avery Homeowner", "CUSTOMER");
const dispatcher = await user("dispatch@example.test", "Morgan Dispatch", "DISPATCHER");
await user("admin@example.test", "Platform Admin", "SUPER_ADMIN");
const contractorOwner = await user("owner@example.test", "Jordan Owner", "CONTRACTOR_OWNER");
const technicianUser = await user("technician@example.test", "John Service", "TECHNICIAN");
const verticalResult = await pool.query<{ id: string }>("INSERT INTO verticals(slug,name,config) VALUES('hvac','HVAC',$1) ON CONFLICT(slug) DO UPDATE SET config=EXCLUDED.config RETURNING id", [JSON.stringify({ branding: { displayName: "Skilled Hire", domain: "skilledhire.ca" }, emergencyRules: [{ targetMinutes: 120, calloutFeeCents: 14900 }], credentialRequirements: [{ code: "HVAC_LICENSE", geography: "ON", verificationRequired: true }] })]);
const vertical = verticalResult.rows[0]?.id; if (!vertical) throw new Error("Missing vertical");
for (const v of [
  { slug: "plumbing", name: "Plumbing Systems", displayName: "Skilled Hire Plumbing" },
  { slug: "electrical", name: "Electrical Contracting", displayName: "Skilled Hire Electrical" },
  { slug: "roofing", name: "Roofing & Exteriors", displayName: "Skilled Hire Roofing" },
] as const) {
  await pool.query(
    "INSERT INTO verticals(slug,name,config) VALUES($1,$2,$3) ON CONFLICT(slug) DO UPDATE SET config=EXCLUDED.config",
    [v.slug, v.name, JSON.stringify({ branding: { displayName: v.displayName, domain: "skilledhire.ca" } })]
  );
}
const categories = ["Heating","Cooling","Thermostat","Air quality","Maintenance","Emergency"];
const categoryIds = new Map<string, string>();
for (const name of categories) { const r = await pool.query<{ id: string }>("INSERT INTO service_categories(vertical_id,slug,name) VALUES($1,$2,$3) ON CONFLICT(vertical_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id", [vertical, name.toLowerCase().replaceAll(" ", "-"), name]); const id = r.rows[0]?.id; if (id) categoryIds.set(name,id); }
const cooling = categoryIds.get("Cooling"); if (!cooling) throw new Error("Missing Cooling category");
const issueResult = await pool.query<{ id: string }>("INSERT INTO issue_types(category_id,slug,name,equipment_fields) VALUES($1,'ac-not-cooling','AC not cooling','[\"manufacturer\",\"model\"]') ON CONFLICT(category_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id", [cooling]);
const issue = issueResult.rows[0]?.id; if (!issue) throw new Error("Missing issue");
const existingProperty = await pool.query<{ id: string }>("SELECT id FROM properties WHERE customer_id=$1 AND label='My Home' LIMIT 1", [customer]);
const property = existingProperty.rows[0]?.id ?? (await pool.query<{ id: string }>("INSERT INTO properties(customer_id,label,address_line1,city,region,postal_code,latitude,longitude) VALUES($1,'My Home','123 King Street W','Toronto','ON','M5H 1J9',43.6487,-79.3817) RETURNING id", [customer])).rows[0]?.id; if (!property) throw new Error("Missing property");
const existingContractor = await pool.query<{ id: string }>("SELECT id FROM contractors WHERE name='ABC Heating & Cooling' LIMIT 1");
const contractor = existingContractor.rows[0]?.id ?? (await pool.query<{ id: string }>("INSERT INTO contractors(owner_user_id,name,status,rating_bps,completion_rate_bps,avg_response_minutes,service_areas,vertical_ids) VALUES($1,'ABC Heating & Cooling','VERIFIED',490,9700,18,'[\"Toronto\"]',$2) RETURNING id", [contractorOwner, JSON.stringify([vertical])])).rows[0]?.id; if (!contractor) throw new Error("Missing contractor");
const existingTechnician = await pool.query<{ id: string }>("SELECT id FROM technicians WHERE user_id=$1", [technicianUser]);
const technician = existingTechnician.rows[0]?.id ?? (await pool.query<{ id: string }>("INSERT INTO technicians(user_id,contractor_id,display_name,active,emergency_available,latitude,longitude) VALUES($1,$2,'John S.',true,true,43.6532,-79.3832) RETURNING id", [technicianUser, contractor])).rows[0]?.id; if (!technician) throw new Error("Missing technician");
await pool.query("INSERT INTO credentials(technician_id,code,geography,status,expiry_date,verified_at) SELECT $1,'HVAC_LICENSE','ON','VERIFIED',current_date + interval '365 days',now() WHERE NOT EXISTS (SELECT 1 FROM credentials WHERE technician_id=$1 AND code='HVAC_LICENSE')", [technician]);
await pool.query("INSERT INTO payment_rules(vertical_id,min_amount_cents,max_amount_cents,rule) SELECT $1,0,NULL,$2 WHERE NOT EXISTS (SELECT 1 FROM payment_rules WHERE vertical_id=$1 AND min_amount_cents=0 AND max_amount_cents IS NULL)", [vertical, JSON.stringify({ milestones: [{ trigger: "QUOTE_APPROVED", percentageBps: 2000, evidenceRequired: false }, { trigger: "CUSTOMER_ACCEPTED", percentageBps: 8000, evidenceRequired: true }] })]);
for (const fixture of [
  { ownerEmail: "north-owner@example.test", technicianEmail: "north-tech@example.test", company: "North Star Mechanical", technicianName: "Priya R.", rating: 480 },
  { ownerEmail: "city-owner@example.test", technicianEmail: "city-tech@example.test", company: "City Comfort Services", technicianName: "Mateo L.", rating: 470 },
] as const) {
  const owner = await user(fixture.ownerEmail, `${fixture.company} Owner`, "CONTRACTOR_OWNER");
  const techUser = await user(fixture.technicianEmail, fixture.technicianName, "TECHNICIAN");
  const existingCompany = await pool.query<{ id: string }>("SELECT id FROM contractors WHERE name=$1 LIMIT 1", [fixture.company]);
  const companyId = existingCompany.rows[0]?.id ?? (await pool.query<{ id: string }>("INSERT INTO contractors(owner_user_id,name,status,rating_bps,completion_rate_bps,avg_response_minutes,service_areas,vertical_ids) VALUES($1,$2,'VERIFIED',$3,9600,25,'[\"Toronto\"]',$4) RETURNING id", [owner,fixture.company,fixture.rating,JSON.stringify([vertical])])).rows[0]?.id;
  if (!companyId) throw new Error("Missing fixture contractor");
  const existingTech = await pool.query<{ id: string }>("SELECT id FROM technicians WHERE user_id=$1", [techUser]);
  const techId = existingTech.rows[0]?.id ?? (await pool.query<{ id: string }>("INSERT INTO technicians(user_id,contractor_id,display_name,active,emergency_available,latitude,longitude) VALUES($1,$2,$3,true,true,43.65,-79.39) RETURNING id", [techUser,companyId,fixture.technicianName])).rows[0]?.id;
  if (!techId) throw new Error("Missing fixture technician");
  await pool.query("INSERT INTO credentials(technician_id,code,geography,status,expiry_date,verified_at) SELECT $1,'HVAC_LICENSE','ON','VERIFIED',current_date + interval '365 days',now() WHERE NOT EXISTS (SELECT 1 FROM credentials WHERE technician_id=$1 AND code='HVAC_LICENSE')", [techId]);
}
console.log("Seeded. Demo password: DemoPassword!2026");
console.log({ customer: "customer@example.test", dispatcher: "dispatch@example.test", technician: "technician@example.test", admin: "admin@example.test", verticalId: vertical, issueId: issue, propertyId: property, technicianId: technician, dispatcherId: dispatcher });
await pool.end();
