"use client";

import { useId, useMemo, useState } from "react";
import type { CredentialGroupCode, EntityLevel } from "@marketplace/contracts";
import { Button, Card, Divider, Grid, Metric, Shell, Status } from "@marketplace/ui";
import {
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  filterComplianceStandards,
} from "@marketplace/vertical-engine";

export default function AdminHome() {
  const [active, setActive] = useState("trust");
  const [selectedVertical, setSelectedVertical] = useState("all");
  const [selectedGeography, setSelectedGeography] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState<CredentialGroupCode | "all">("all");
  const [auditFilter, setAuditFilter] = useState<"ALL" | "EXPIRING" | "PENDING">("ALL");

  const filteredStandards = useMemo(() => {
    return DEFAULT_COMPLIANCE_STANDARDS.filter((s) => {
      const vertMatch = selectedVertical === "all" || s.verticalSlug === "*" || s.verticalSlug === selectedVertical;
      const geoMatch = selectedGeography === "all" || s.geography === "*" || s.geography === selectedGeography;
      const groupMatch = selectedGroup === "all" || s.groupCode === selectedGroup;
      return vertMatch && geoMatch && groupMatch;
    });
  }, [selectedVertical, selectedGeography, selectedGroup]);

  const verticalSelectId = useId();
  const geographySelectId = useId();
  const groupSelectId = useId();

  return (
    <Shell
      title="Skilled Hire Platform Administration"
      subtitle="Manage vertical configuration, statutory compliance standards, trust controls, policies, and audit activity for skilledhire.ca."
      eyebrow="SKILLED HIRE · ADMINISTRATION & TRUST"
    >
      <Grid columns="repeat(4, minmax(0, 1fr))">
        <Card><Metric label="Regulatory Groups" value={String(CREDENTIAL_GROUPS.length)} detail="6 statutory pillars" /></Card>
        <Card><Metric label="Active Standards" value={String(DEFAULT_COMPLIANCE_STANDARDS.length)} detail="Across 5 jurisdictions" /></Card>
        <Card><Metric label="Contractors Verified" value="3" detail="100% compliant" /></Card>
        <Card><Metric label="Credentials Expiring" value="2" detail="Within 30 days" /></Card>
      </Grid>

      <Grid columns="220px minmax(0, 1fr)">
        <Card>
          <div style={{ display: "grid", gap: 8 }}>
            <Button variant={active === "trust" ? "primary" : "quiet"} onClick={() => setActive("trust")}>
              🛡️ Trust & Compliance
            </Button>
            <Button variant={active === "vertical" ? "primary" : "quiet"} onClick={() => setActive("vertical")}>
              Verticals
            </Button>
            <Button variant={active === "payments" ? "primary" : "quiet"} onClick={() => setActive("payments")}>
              Payment Policies
            </Button>
            <Button variant={active === "disputes" ? "primary" : "quiet"} onClick={() => setActive("disputes")}>
              ⚖️ Disputes & Escrow
            </Button>
            <Button variant={active === "audit" ? "primary" : "quiet"} onClick={() => setActive("audit")}>
              Audit Log
            </Button>
          </div>
        </Card>

        <div>
          {active === "trust" && (
            <>
              <Card tone="blue">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <Status tone="blue">Regulatory Standards Registry</Status>
                    <h2 style={{ margin: "6px 0 4px" }}>Cross-Location Compliance & Certification Matrix</h2>
                    <p style={{ color: "#52606d", margin: 0, fontSize: 14, maxWidth: 680 }}>
                      Statutory government regulations, trade licensing, environmental mandates (EPA/ODS), and insurance minimums configured across domains and locations. Prospective service providers are verified against this master standard.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => alert("Verification audit queue synced.")}>
                    Sync Registry
                  </Button>
                </div>
              </Card>

              {/* Regulatory Groups Pill Grid */}
              <Card>
                <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Canonical Regulatory Pillars ({CREDENTIAL_GROUPS.length})</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                  {CREDENTIAL_GROUPS.map((g) => {
                    const count = DEFAULT_COMPLIANCE_STANDARDS.filter((s) => s.groupCode === g.code).length;
                    return (
                      <div
                        key={g.code}
                        onClick={() => setSelectedGroup(selectedGroup === g.code ? "all" : g.code)}
                        style={{
                          border: `1px solid ${selectedGroup === g.code ? "#1d4ed8" : "#e2e8f0"}`,
                          background: selectedGroup === g.code ? "#eff6ff" : "#f8fafc",
                          borderRadius: 8,
                          padding: "10px 12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: 13, color: selectedGroup === g.code ? "#1d4ed8" : "#172033" }}>{g.name}</strong>
                          <span style={{ fontSize: 12, fontWeight: 800, background: "#e2e8f0", padding: "2px 6px", borderRadius: 999 }}>
                            {count} stds
                          </span>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.3 }}>{g.description}</p>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Filters */}
              <Card>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <label htmlFor={verticalSelectId} style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b" }}>DOMAIN</label>
                      <select
                        id={verticalSelectId}
                        value={selectedVertical}
                        onChange={(e) => setSelectedVertical(e.target.value)}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d9e2ec", fontWeight: 700 }}
                      >
                        <option value="all">All Domains (Cross-Vertical)</option>
                        <option value="hvac">HVAC & Refrigeration</option>
                        <option value="plumbing">Plumbing Systems</option>
                        <option value="electrical">Electrical Contracting</option>
                        <option value="roofing">Roofing & Exteriors</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor={geographySelectId} style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b" }}>LOCATION</label>
                      <select
                        id={geographySelectId}
                        value={selectedGeography}
                        onChange={(e) => setSelectedGeography(e.target.value)}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d9e2ec", fontWeight: 700 }}
                      >
                        <option value="all">All Locations (Universal + Regional)</option>
                        <option value="ON">Ontario (Canada)</option>
                        <option value="BC">British Columbia (Canada)</option>
                        <option value="CA">California (USA)</option>
                        <option value="TX">Texas (USA)</option>
                        <option value="*">Federal / Universal (*)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor={groupSelectId} style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b" }}>GROUP</label>
                      <select
                        id={groupSelectId}
                        value={selectedGroup}
                        onChange={(e) => setSelectedGroup(e.target.value as any)}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d9e2ec", fontWeight: 700 }}
                      >
                        <option value="all">All Regulatory Groups</option>
                        {CREDENTIAL_GROUPS.map((g) => (
                          <option key={g.code} value={g.code}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <span style={{ fontSize: 13, fontWeight: 700, color: "#52606d" }}>
                    Showing {filteredStandards.length} of {DEFAULT_COMPLIANCE_STANDARDS.length} standards
                  </span>
                </div>
              </Card>

              {/* Master Standards Registry Table */}
              <Card>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #cbd5e1", color: "#475569" }}>
                        <th style={{ padding: "8px 10px" }}>Standard Name & Code</th>
                        <th style={{ padding: "8px 10px" }}>Group</th>
                        <th style={{ padding: "8px 10px" }}>Location</th>
                        <th style={{ padding: "8px 10px" }}>Entity</th>
                        <th style={{ padding: "8px 10px" }}>Mandatory?</th>
                        <th style={{ padding: "8px 10px" }}>Issuing Authority</th>
                        <th style={{ padding: "8px 10px" }}>Verification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStandards.map((s) => (
                        <tr key={s.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{ padding: "10px" }}>
                            <strong>{s.name}</strong>
                            <div style={{ color: "#64748b", fontSize: 11 }}>Code: {s.credentialCode}</div>
                          </td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#f1f5f9" }}>
                              {CREDENTIAL_GROUPS.find((g) => g.code === s.groupCode)?.name.split(" ")[0]}
                            </span>
                          </td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ fontWeight: 800 }}>{s.geography === "*" ? "Universal (*)" : s.geography}</span>
                          </td>
                          <td style={{ padding: "10px" }}>
                            {s.entityLevel === "CONTRACTOR" ? "🏢 Contractor" : "👷 Technician"}
                          </td>
                          <td style={{ padding: "10px" }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: s.requirementLevel === "MANDATORY" ? "#fee2e2" : "#f1f5f9",
                              color: s.requirementLevel === "MANDATORY" ? "#991b1b" : "#475569",
                            }}>
                              {s.requirementLevel}
                            </span>
                          </td>
                          <td style={{ padding: "10px" }}>
                            {s.issuingAuthority}
                            {s.legalReference && <div style={{ fontSize: 11, color: "#64748b" }}>{s.legalReference}</div>}
                          </td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: s.verificationMethod === "REGISTRY_API" ? "#1d4ed8" : "#475569" }}>
                              {s.verificationMethod === "REGISTRY_API" ? "⚡ API Registry" : "📄 Doc Audit"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          {active === "vertical" && (
            <Card>
              <Status>HVAC · active</Status>
              <h2>Vertical Configuration</h2>
              <p style={{ color: "#52606d" }}>Categories, issues, emergency rules, credential requirements, payment milestones, fees, and warranties are data-driven.</p>
              <Divider />
              <Grid>
                <div>
                  <strong>Categories</strong>
                  <p style={{ color: "#52606d" }}>Heating · Cooling · Thermostat · Air quality · Maintenance · Emergency</p>
                </div>
                <div>
                  <strong>Required credential</strong>
                  <p style={{ color: "#52606d" }}>HVAC_LICENSE · Ontario · verified</p>
                </div>
              </Grid>
              <Button>Open configuration</Button>
            </Card>
          )}

          {active === "payments" && (
            <Card>
              <Status tone="blue">Configurable</Status>
              <h2>Payment Policies</h2>
              <p style={{ color: "#52606d" }}>The active HVAC rule is 20% at quote approval and 80% at customer acceptance. Rules are selected by vertical and quote amount.</p>
              <Button>Manage payment rules</Button>
            </Card>
          )}

          {active === "disputes" && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <Status tone="amber">Active Dispute Arbitration</Status>
                  <h2 style={{ margin: "6px 0 4px" }}>Dispute Resolution & Escrow Settlement</h2>
                  <p style={{ color: "#52606d", margin: 0, fontSize: 14 }}>
                    Arbitrate customer warranty and quality disputes. Funds in held escrow can be released to the contractor, refunded to the customer, or split equally via POST /v1/disputes/:id/resolve.
                  </p>
                </div>
              </div>
              <Divider />
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong>Dispute #DSP-8921 · AC cooling efficiency</strong>
                    <Status tone="blue">Investigation Stage</Status>
                  </div>
                  <p style={{ margin: "0 0 8px", fontSize: 14, color: "#52606d" }}>
                    Customer: Avery Homeowner · Contractor: ABC Heating & Cooling · Escrow Held: $233.91 CAD
                  </p>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#334155" }}>
                    <em>"System is cooling but air flow seems slightly low after capacitor installation. Requesting technician re-check or partial courtesy refund."</em>
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button variant="primary" onClick={() => alert("Escrow funds released to ABC Heating & Cooling via POST /v1/disputes/:id/resolve.")}>
                      Release to Contractor ($233.91)
                    </Button>
                    <Button variant="secondary" onClick={() => alert("Full refund issued to Avery Homeowner via POST /v1/disputes/:id/resolve.")}>
                      Full Refund to Customer
                    </Button>
                    <Button variant="secondary" onClick={() => alert("Split 50/50: $116.95 released to contractor, $116.96 refunded to customer.")}>
                      Split Escrow 50/50
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {active === "audit" && (
            <Card>
              <Status>Append-only</Status>
              <h2>Recent Audit Activity</h2>
              <p style={{ color: "#52606d" }}>Compliance standard verified · Quote accepted · Payment succeeded · Technician assigned</p>
              <Button variant="secondary">Export audit log</Button>
            </Card>
          )}
        </div>
      </Grid>
    </Shell>
  );
}
