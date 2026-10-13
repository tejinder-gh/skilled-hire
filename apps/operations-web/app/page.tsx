"use client";

import { useEffect, useState } from "react";
import type {
  MarketplaceOperationalAlert,
  SupplyCoverageNeighbourhood,
} from "@marketplace/contracts";
import { Badge, Button, Card, Divider, Grid, Metric, Shell, Status, Stepper } from "@marketplace/ui";

export default function OperationsHome() {
  const [qualified, setQualified] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [leadId, setLeadId] = useState<string>("10428");
  const [apiSynced, setApiSynced] = useState(false);
  const [alerts, setAlerts] = useState<MarketplaceOperationalAlert[]>([]);
  const [coverage, setCoverage] = useState<SupplyCoverageNeighbourhood[]>([]);

  useEffect(() => {
    async function fetchOperationsData() {
      try {
        const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "dispatch@example.test", password: "DemoPassword!2026" }),
        });
        if (loginRes.ok) {
          const { accessToken } = await loginRes.json();
          const authHeaders = { Authorization: `Bearer ${accessToken}` };

          // 1. Fetch leads
          const listRes = await fetch("http://localhost:4000/v1/service-requests", {
            headers: authHeaders,
          });
          if (listRes.ok) {
            const requests = await listRes.json();
            if (requests.length > 0) {
              setLeadId(requests[0].id.slice(0, 8).toUpperCase());
              setApiSynced(true);
            }
          }

          // 2. Fetch active operational alerts
          const alertsRes = await fetch("http://localhost:4000/v1/analytics/alerts?status=ACTIVE", {
            headers: authHeaders,
          });
          if (alertsRes.ok) {
            const alertsData = await alertsRes.json();
            setAlerts(alertsData.alerts || []);
          }

          // 3. Fetch supply coverage
          const coverageRes = await fetch("http://localhost:4000/v1/analytics/supply-coverage", {
            headers: authHeaders,
          });
          if (coverageRes.ok) {
            const coverageData = await coverageRes.json();
            setCoverage(coverageData.coverage || []);
          }
        }
      } catch {
        // Fall back to offline demo data
        setAlerts([
          {
            id: "alt-mock-1",
            alertType: "SUPPLY_DEFICIT",
            severity: "CRITICAL",
            status: "ACTIVE",
            title: "Elevated Intake In Downtown Core",
            description: "Intake volume exceeding current active verified capacity by 28% in Downtown Toronto.",
            neighbourhood: "Downtown Toronto",
            createdAt: new Date().toISOString(),
          },
        ]);
        setCoverage([
          {
            neighbourhood: "Downtown Toronto",
            verticalSlug: "ontario-hvac",
            verticalName: "Residential HVAC",
            registeredProviders: 6,
            verifiedProviders: 5,
            activeDispatchedProviders: 5,
            capacitySaturationBps: 9167,
            coverageStatus: "CONSTRAINED",
            estimatedWaitMinutes: 24,
          },
          {
            neighbourhood: "Mississauga Central",
            verticalSlug: "ontario-hvac",
            verticalName: "Residential HVAC",
            registeredProviders: 4,
            verifiedProviders: 4,
            activeDispatchedProviders: 2,
            capacitySaturationBps: 6000,
            coverageStatus: "OPTIMAL",
            estimatedWaitMinutes: 12,
          },
          {
            neighbourhood: "North York Core",
            verticalSlug: "ontario-hvac",
            verticalName: "Residential HVAC",
            registeredProviders: 5,
            verifiedProviders: 4,
            activeDispatchedProviders: 3,
            capacitySaturationBps: 7778,
            coverageStatus: "ADEQUATE",
            estimatedWaitMinutes: 18,
          },
        ]);
      }
    }
    fetchOperationsData();
  }, []);

  async function handleAcknowledgeAlert(alertId: string) {
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dispatch@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        await fetch(`http://localhost:4000/v1/analytics/alerts/${alertId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ status: "ACKNOWLEDGED" }),
        });
      }
    } catch {
      // Graceful offline fallback
    }
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  async function handleQualify() {
    setProcessing(true);
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dispatch@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        const listRes = await fetch("http://localhost:4000/v1/service-requests", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (listRes.ok) {
          const requests = await listRes.json();
          const target = requests[0];
          if (target) {
            await fetch(`http://localhost:4000/v1/service-requests/${target.id}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ to: "QUALIFIED" }),
            });
            setApiSynced(true);
          }
        }
      }
    } catch {
      // Graceful offline fallback
    } finally {
      setProcessing(false);
      setQualified(true);
    }
  }

  async function handleAssign() {
    setProcessing(true);
    try {
      const loginRes = await fetch("http://localhost:4000/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dispatch@example.test", password: "DemoPassword!2026" }),
      });
      if (loginRes.ok) {
        const { accessToken } = await loginRes.json();
        const listRes = await fetch("http://localhost:4000/v1/service-requests", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (listRes.ok) {
          const requests = await listRes.json();
          const target = requests[0];
          if (target) {
            const candRes = await fetch(`http://localhost:4000/v1/dispatch/${target.id}/candidates`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (candRes.ok) {
              const { candidates } = await candRes.json();
              if (candidates[0]?.technicianId) {
                await fetch(`http://localhost:4000/v1/dispatch/${target.id}/assign`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                  body: JSON.stringify({ technicianId: candidates[0].technicianId }),
                });
                setApiSynced(true);
              }
            }
          }
        }
      }
    } catch {
      // Graceful fallback
    } finally {
      setProcessing(false);
      setAssigned(true);
    }
  }

  return (
    <Shell
      title="Skilled Hire Operations Control"
      subtitle="Human judgement stays in the loop for qualification, dispatch, quote review, exceptions, and customer support on skilledhire.ca."
      eyebrow="SKILLED HIRE · OPERATIONS DISPATCH"
    >
      {/* Active Operational Alerts Ticker */}
      {alerts.length > 0 && (
        <Card tone="amber" padding="md">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <strong style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "#92400e" }}>
                Active Operational Dispatch Alerts ({alerts.length})
              </strong>
            </div>
            <span style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>Real-time Feed</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {alerts.map((alt) => (
              <div
                key={alt.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#fff",
                  borderRadius: 10,
                  border: "1px solid #fde68a",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Badge tone={alt.severity === "CRITICAL" ? "danger" : alt.severity === "WARNING" ? "amber" : "blue"}>
                    {alt.severity}
                  </Badge>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{alt.title}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {alt.description}
                      {alt.neighbourhood ? ` • Area: ${alt.neighbourhood}` : ""}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => handleAcknowledgeAlert(alt.id)}>
                  Acknowledge
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* High-level KPI grid */}
      <Grid columns="repeat(4, minmax(0, 1fr))">
        <Card><Metric label="New leads" value="12" detail="3 emergency" /></Card>
        <Card><Metric label="Awaiting assignment" value="4" detail="Oldest 18 min" /></Card>
        <Card><Metric label="Active jobs" value="28" detail="2 on hold" /></Card>
        <Card><Metric label="SLA at risk" value="2" detail="Needs review" /></Card>
      </Grid>

      {/* Main Dispatch Work Area & Candidate Signals */}
      <Grid columns="minmax(0, 1.35fr) minmax(260px, .65fr)">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <Status tone={assigned ? "green" : qualified ? "blue" : "amber"}>
                {assigned ? "Assigned · Tech En Route" : qualified ? "Qualified · Ready to dispatch" : "New lead"}
              </Status>
              <h2 style={{ margin: "8px 0 4px" }}>AC not cooling · Toronto</h2>
              <p style={{ color: "#52606d", margin: 0 }}>Standard · Preferred today 1:00–3:00 PM · Photo attached · HVAC / Cooling</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontWeight: 850, fontSize: 14 }}>Lead #{leadId}</span>
              {apiSynced && <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>● Live DB Connected</div>}
            </div>
          </div>
          <Divider />
          <p style={{ color: "#52606d" }}>
            Customer: Avery Homeowner · My Home · 123 King Street W. Description: system runs, but the air stays warm.
          </p>
          {!qualified ? (
            <Button onClick={handleQualify} disabled={processing}>
              {processing ? "Qualifying Lead..." : "Qualify request"}
            </Button>
          ) : !assigned ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button onClick={handleAssign} disabled={processing}>
                {processing ? "Assigning Tech..." : "Assign John S."}
              </Button>
              <Button variant="secondary">View ranked candidates</Button>
              <Button variant="quiet">Hold for customer</Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Status tone="green">John S. · ABC Heating & Cooling</Status>
              <Button variant="secondary">Reassign</Button>
              <Button variant="secondary">Open job timeline</Button>
            </div>
          )}
        </Card>
        <Card tone="blue">
          <h3 style={{ marginTop: 0 }}>Dispatch signals</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <strong>1. John S.</strong>
              <p style={{ margin: "3px 0", color: "#52606d", fontSize: 13 }}>1.2 km · ★ 4.9 · 97% completion</p>
            </div>
            <div>
              <strong>✓ Credentials</strong>
              <p style={{ margin: "3px 0", color: "#52606d", fontSize: 13 }}>HVAC_LICENSE verified through Aug 2027</p>
            </div>
            <div>
              <strong>Availability</strong>
              <p style={{ margin: "3px 0", color: "#52606d", fontSize: 13 }}>Today 1:00–3:00 PM · emergency capable</p>
            </div>
          </div>
        </Card>
      </Grid>

      {/* Lead workflow stepper */}
      <Card>
        <h2 style={{ marginTop: 0 }}>Lead workflow</h2>
        <Stepper steps={["New lead", "Qualified", "Appointment", "Assigned", "Quote review", "Completed"]} current={assigned ? 3 : qualified ? 1 : 0} />
      </Card>

      {/* Regional Supply Coverage Radar */}
      {coverage.length > 0 && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: "0 0 4px" }}>Neighbourhood Supply Coverage Radar</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                Live capacity saturation across Ontario territories for proactive dispatch balancing.
              </p>
            </div>
            <Status tone="blue">{coverage.length} Zones Tracked</Status>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {coverage.map((item) => (
              <div
                key={`${item.neighbourhood}-${item.verticalSlug}`}
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  background: item.coverageStatus === "DEFICIENT" ? "#fef2f2" : "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: 14, color: "#0f172a" }}>{item.neighbourhood}</strong>
                  <Badge
                    tone={
                      item.coverageStatus === "OPTIMAL"
                        ? "green"
                        : item.coverageStatus === "ADEQUATE"
                        ? "blue"
                        : item.coverageStatus === "CONSTRAINED"
                        ? "amber"
                        : "danger"
                    }
                  >
                    {item.coverageStatus}
                  </Badge>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                  Vertical: <strong>{item.verticalName}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#334155" }}>
                  <span>Verified Providers: <strong>{item.verifiedProviders}</strong>/{item.registeredProviders}</span>
                  <span>Saturation: <strong>{(item.capacitySaturationBps / 100).toFixed(0)}%</strong></span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  );
}
