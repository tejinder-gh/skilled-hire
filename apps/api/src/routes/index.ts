import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.routes.js";
import { intakeRoutes } from "./intake.routes.js";
import { catalogRoutes } from "./catalog.routes.js";
import { complianceRoutes } from "./compliance.routes.js";
import { propertiesRoutes } from "./properties.routes.js";
import { requestRoutes } from "./requests.routes.js";
import { jobsRoutes } from "./jobs.routes.js";
import { dispatchRoutes } from "./dispatch.routes.js";
import { quotesRoutes } from "./quotes.routes.js";
import { changeOrdersRoutes } from "./change-orders.routes.js";
import { paymentsRoutes } from "./payments.routes.js";
import { supportRoutes } from "./support.routes.js";
import { capabilityRoutes } from "./capability.routes.js";
import { safetyRoutes } from "./safety.routes.js";
import { permitsRoutes } from "./permits.routes.js";
import { riskRoutes } from "./risk.routes.js";
import { legalRoutes } from "./legal.routes.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes);
  await app.register(intakeRoutes);
  await app.register(catalogRoutes);
  await app.register(complianceRoutes);
  await app.register(capabilityRoutes);
  await app.register(safetyRoutes);
  await app.register(permitsRoutes);
  await app.register(riskRoutes);
  await app.register(legalRoutes);
  await app.register(propertiesRoutes);
  await app.register(requestRoutes);
  await app.register(jobsRoutes);
  await app.register(dispatchRoutes);
  await app.register(quotesRoutes);
  await app.register(changeOrdersRoutes);
  await app.register(paymentsRoutes);
  await app.register(supportRoutes);
}
