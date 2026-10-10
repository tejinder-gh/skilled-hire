"use client";

import { useEffect, useState } from "react";
import { Button, Card, Divider, Grid, Metric, Shell, Status, Stepper } from "@marketplace/ui";

export default function OperationsHome() {
  const [qualified, setQualified] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [leadId, setLeadId] = useState<string>("10428");
  const [apiSynced, setApiSynced] = useState(false);

  useEffect(() => {
    async function fetchLeads() {
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
            if (requests.length > 0) {
              setLeadId(requests[0].id.slice(0, 8).toUpperCase());
              setApiSynced(true);
            }
          }
        }
      } catch {
        // Fall back to offline demo data
      }
    }
    fetchLeads();
  }, []);

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
      <Grid columns="repeat(4, minmax(0, 1fr))">
        <Card><Metric label="New leads" value="12" detail="3 emergency" /></Card>
        <Card><Metric label="Awaiting assignment" value="4" detail="Oldest 18 min" /></Card>
        <Card><Metric label="Active jobs" value="28" detail="2 on hold" /></Card>
        <Card><Metric label="SLA at risk" value="2" detail="Needs review" /></Card>
      </Grid>
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
      <Card>
        <h2 style={{ marginTop: 0 }}>Lead workflow</h2>
        <Stepper steps={["New lead", "Qualified", "Appointment", "Assigned", "Quote review", "Completed"]} current={assigned ? 3 : qualified ? 1 : 0} />
      </Card>
    </Shell>
  );
}
