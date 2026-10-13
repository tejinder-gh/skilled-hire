import type { FastifyInstance } from "fastify";
import {
  db,
  and,
  desc,
  eq,
  ilike,
  ne,
  contractors,
  credentials,
  providerOnboardingApplications,
  providerServiceGeographyApprovals,
  providerTechnicianRosters,
  technicians,
  userRoles,
  users,
} from "@marketplace/database";
import {
  assessOnboardingReadiness,
  checkRateProposalSanity,
  validateAndNormalizePostalTerritories,
  validateTradeVerticals,
} from "@marketplace/vertical-engine";
import {
  providerApplicationsQuerySchema,
  providerApplicationReviewSchema,
  providerDraftApplicationSchema,
  providerSubmitApplicationSchema,
} from "@marketplace/validation";
import type {
  ProviderApplicationDTO,
  ProviderRateProposal,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse } from "../common/auth.js";

function generateSaveToken(): string {
  return `tok_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function generateApplicationId(): string {
  return `APP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
}

export async function providerOnboardingRoutes(
  app: FastifyInstance,
): Promise<void> {
  // 1. POST /v1/providers/onboarding/draft - Save or update draft prospect
  app.post("/v1/providers/onboarding/draft", async (request, reply) => {
    const body = parse(providerDraftApplicationSchema, request.body);

    let saveToken = body.saveToken;
    let existingApp = null;

    if (saveToken) {
      const [found] = await db
        .select()
        .from(providerOnboardingApplications)
        .where(eq(providerOnboardingApplications.saveToken, saveToken))
        .limit(1);
      existingApp = found;
    }

    const normalizedPostals = body.postalCodes
      ? validateAndNormalizePostalTerritories(body.postalCodes).normalizedFsaList
      : [];

    if (existingApp) {
      const [updated] = await db
        .update(providerOnboardingApplications)
        .set({
          prospectEmail: body.prospectEmail,
          businessName: body.businessName,
          businessNumber: body.businessNumber ?? existingApp.businessNumber,
          businessType: body.businessType ?? existingApp.businessType,
          phone: body.phone,
          postalCodes: normalizedPostals.length > 0 ? normalizedPostals : existingApp.postalCodes,
          selectedVerticals: body.selectedVerticals ?? existingApp.selectedVerticals,
          serviceRatesProposal: body.serviceRatesProposal ?? existingApp.serviceRatesProposal,
          weeklyCapacity: body.weeklyCapacity ?? existingApp.weeklyCapacity,
          draftStep: body.draftStep ?? existingApp.draftStep,
          draftPayload: body.draftPayload ?? existingApp.draftPayload,
          updatedAt: new Date(),
        })
        .where(eq(providerOnboardingApplications.id, existingApp.id))
        .returning();

      if (!updated) {
        return reply.code(500).send({
          statusCode: 500,
          code: "UPDATE_FAILED",
          message: "Failed to update onboarding draft.",
        });
      }

      return reply.code(200).send({
        applicationId: updated.id,
        saveToken: updated.saveToken,
        status: updated.status,
        draftStep: updated.draftStep,
        expiresInDays: 30,
        message: "Onboarding draft updated successfully.",
      });
    }

    saveToken = generateSaveToken();
    const appId = generateApplicationId();

    const [created] = await db
      .insert(providerOnboardingApplications)
      .values({
        id: appId,
        prospectEmail: body.prospectEmail,
        businessName: body.businessName,
        businessNumber: body.businessNumber,
        businessType: body.businessType ?? "CORPORATION",
        phone: body.phone,
        postalCodes: normalizedPostals,
        selectedVerticals: body.selectedVerticals ?? [],
        serviceRatesProposal: body.serviceRatesProposal ?? [],
        weeklyCapacity: body.weeklyCapacity ?? 10,
        technicianCount: 1,
        status: "PROSPECT",
        saveToken,
        draftStep: body.draftStep ?? 1,
        draftPayload: body.draftPayload ?? {},
        consentAccepted: false,
      })
      .returning();

    if (!created) {
      return reply.code(500).send({
        statusCode: 500,
        code: "CREATE_FAILED",
        message: "Failed to create onboarding draft.",
      });
    }

    return reply.code(201).send({
      applicationId: created.id,
      saveToken: created.saveToken,
      status: created.status,
      draftStep: created.draftStep,
      expiresInDays: 30,
      message: "Onboarding prospect draft created successfully.",
    });
  });

  // 2. GET /v1/providers/onboarding/draft/:saveToken - Resume draft application
  app.get(
    "/v1/providers/onboarding/draft/:saveToken",
    async (request, reply) => {
      const { saveToken } = request.params as { saveToken: string };

      const [found] = await db
        .select()
        .from(providerOnboardingApplications)
        .where(eq(providerOnboardingApplications.saveToken, saveToken))
        .limit(1);

      if (!found) {
        return reply.code(404).send({
          statusCode: 404,
          code: "DRAFT_NOT_FOUND",
          message: "No active onboarding draft found with this resume token.",
        });
      }

      const techniciansList = await db
        .select()
        .from(providerTechnicianRosters)
        .where(eq(providerTechnicianRosters.applicationId, found.id));

      return reply.code(200).send({
        ...found,
        technicians: techniciansList,
      });
    },
  );

  // 3. POST /v1/providers/onboarding/submit - Validate & submit complete application
  app.post("/v1/providers/onboarding/submit", async (request, reply) => {
    const body = parse(providerSubmitApplicationSchema, request.body);

    const [found] = await db
      .select()
      .from(providerOnboardingApplications)
      .where(eq(providerOnboardingApplications.saveToken, body.saveToken))
      .limit(1);

    if (!found) {
      return reply.code(404).send({
        statusCode: 404,
        code: "DRAFT_NOT_FOUND",
        message: "No active onboarding draft found for submission.",
      });
    }

    // Duplicate business identity prevention
    const [existingBiz] = await db
      .select()
      .from(providerOnboardingApplications)
      .where(
        and(
          eq(providerOnboardingApplications.businessNumber, body.businessNumber),
          ne(providerOnboardingApplications.id, found.id),
          ne(providerOnboardingApplications.status, "REJECTED"),
          ne(providerOnboardingApplications.status, "ABANDONED"),
        ),
      )
      .limit(1);

    if (existingBiz) {
      return reply.code(409).send({
        statusCode: 409,
        code: "DUPLICATE_BUSINESS_IDENTITY",
        message: `An active provider account or pending application already exists for Business Number '${body.businessNumber}'.`,
      });
    }

    // Postal code territory validation
    const postalVal = validateAndNormalizePostalTerritories(body.postalCodes);
    if (!postalVal.valid) {
      return reply.code(400).send({
        statusCode: 400,
        code: "INVALID_POSTAL_TERRITORY",
        message: `Invalid Ontario postal code(s): ${postalVal.invalidCodes.join(", ")}`,
      });
    }

    // Trade vertical validation
    const tradeVal = validateTradeVerticals(body.selectedVerticals);
    if (!tradeVal.valid) {
      return reply.code(400).send({
        statusCode: 400,
        code: "INVALID_TRADE_VERTICAL",
        message: `Invalid service trade vertical(s): ${tradeVal.invalidSlugs.join(", ")}`,
      });
    }

    // Rate sanity check
    const rateSanity = checkRateProposalSanity(body.serviceRatesProposal);
    if (!rateSanity.valid) {
      return reply.code(400).send({
        statusCode: 400,
        code: "RATE_PROPOSAL_ANOMALY",
        message: rateSanity.anomalies.join(" "),
      });
    }

    // Insert technicians into roster
    await db
      .delete(providerTechnicianRosters)
      .where(eq(providerTechnicianRosters.applicationId, found.id));

    for (const tech of body.technicians) {
      await db.insert(providerTechnicianRosters).values({
        id: `TECH-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        applicationId: found.id,
        fullName: tech.fullName,
        email: tech.email,
        phone: tech.phone,
        tradeLicenseCode: tech.tradeLicenseCode,
        licenseNumber: tech.licenseNumber,
        licenseExpiry: tech.licenseExpiry,
        isEmergencyAvailable: tech.isEmergencyAvailable ?? false,
      });
    }

    // Initialize pending service-geography approvals
    await db
      .delete(providerServiceGeographyApprovals)
      .where(eq(providerServiceGeographyApprovals.applicationId, found.id));

    for (const vertical of body.selectedVerticals) {
      for (const fsa of postalVal.normalizedFsaList) {
        await db.insert(providerServiceGeographyApprovals).values({
          id: `APV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          applicationId: found.id,
          verticalSlug: vertical,
          territoryCode: fsa,
          status: "PENDING",
        });
      }
    }

    // Update application to SUBMITTED
    const [submitted] = await db
      .update(providerOnboardingApplications)
      .set({
        businessNumber: body.businessNumber,
        businessType: body.businessType,
        postalCodes: postalVal.normalizedFsaList,
        selectedVerticals: body.selectedVerticals,
        serviceRatesProposal: body.serviceRatesProposal,
        weeklyCapacity: body.weeklyCapacity,
        technicianCount: body.technicians.length,
        status: "SUBMITTED",
        consentAccepted: true,
        consentAcceptedAt: new Date(),
        applicantUserId: body.applicantUserId,
        updatedAt: new Date(),
      })
      .where(eq(providerOnboardingApplications.id, found.id))
      .returning();

    if (!submitted) {
      return reply.code(500).send({
        statusCode: 500,
        code: "SUBMIT_FAILED",
        message: "Failed to submit onboarding application.",
      });
    }

    return reply.code(200).send({
      applicationId: submitted.id,
      status: submitted.status,
      technicianCount: submitted.technicianCount,
      territoriesCount: postalVal.normalizedFsaList.length,
      message:
        "Provider onboarding application successfully submitted and queued for operations review.",
    });
  });

  // 4. GET /v1/providers/onboarding/crm/applications - List CRM applications (Ops/Admin)
  app.get(
    "/v1/providers/onboarding/crm/applications",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations and admins can access the provider CRM queue",
        });
      }

      const query = parse(
        providerApplicationsQuerySchema,
        request.query,
      );

      const conditions = [];
      if (query.status && query.status !== "ALL") {
        conditions.push(eq(providerOnboardingApplications.status, query.status));
      }
      if (query.search) {
        conditions.push(
          ilike(providerOnboardingApplications.businessName, `%${query.search}%`),
        );
      }

      const appsList = await db
        .select()
        .from(providerOnboardingApplications)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(providerOnboardingApplications.createdAt));

      return reply.code(200).send(appsList);
    },
  );

  // 5. GET /v1/providers/onboarding/crm/applications/:id - Detailed application dossier (Ops/Admin)
  app.get(
    "/v1/providers/onboarding/crm/applications/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations and admins can view provider application dossiers",
        });
      }

      const { id } = request.params as { id: string };

      const [found] = await db
        .select()
        .from(providerOnboardingApplications)
        .where(eq(providerOnboardingApplications.id, id))
        .limit(1);

      if (!found) {
        return reply.code(404).send({
          statusCode: 404,
          code: "APPLICATION_NOT_FOUND",
          message: "Provider application not found.",
        });
      }

      const techs = await db
        .select()
        .from(providerTechnicianRosters)
        .where(eq(providerTechnicianRosters.applicationId, found.id));

      const approvals = await db
        .select()
        .from(providerServiceGeographyApprovals)
        .where(eq(providerServiceGeographyApprovals.applicationId, found.id));

      const appDto: ProviderApplicationDTO = {
        id: found.id,
        prospectEmail: found.prospectEmail,
        businessName: found.businessName,
        businessNumber: found.businessNumber ?? undefined,
        businessType: found.businessType as ProviderApplicationDTO["businessType"],
        phone: found.phone,
        postalCodes: (found.postalCodes as string[]) || [],
        selectedVerticals: (found.selectedVerticals as string[]) || [],
        serviceRatesProposal: (found.serviceRatesProposal as ProviderRateProposal[]) || [],
        weeklyCapacity: found.weeklyCapacity,
        technicianCount: found.technicianCount,
        status: found.status as ProviderApplicationDTO["status"],
        saveToken: found.saveToken,
        draftStep: found.draftStep,
        consentAccepted: found.consentAccepted,
        consentAcceptedAt: found.consentAcceptedAt ? found.consentAcceptedAt.toISOString() : undefined,
        applicantUserId: found.applicantUserId ?? undefined,
        convertedContractorId: found.convertedContractorId ?? undefined,
        reviewedByUserId: found.reviewedByUserId ?? undefined,
        reviewNotes: found.reviewNotes ?? undefined,
        createdAt: found.createdAt.toISOString(),
        updatedAt: found.updatedAt.toISOString(),
        technicians: techs.map((t) => ({
          id: t.id,
          applicationId: t.applicationId,
          fullName: t.fullName,
          email: t.email,
          phone: t.phone,
          tradeLicenseCode: t.tradeLicenseCode,
          licenseNumber: t.licenseNumber,
          licenseExpiry: t.licenseExpiry,
          backgroundCheckStatus: t.backgroundCheckStatus as any,
          isEmergencyAvailable: t.isEmergencyAvailable,
          createdAt: t.createdAt.toISOString(),
        })),
        approvals: approvals.map((a) => ({
          id: a.id,
          applicationId: a.applicationId,
          contractorId: a.contractorId ?? undefined,
          verticalSlug: a.verticalSlug,
          territoryCode: a.territoryCode,
          status: a.status,
          decisionReason: a.decisionReason ?? undefined,
          reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : undefined,
        })),
      };

      const readiness = assessOnboardingReadiness(appDto);

      return reply.code(200).send({
        application: appDto,
        readiness,
      });
    },
  );

  // 6. POST /v1/providers/onboarding/crm/applications/:id/review - Review & Provision (Ops/Admin)
  app.post(
    "/v1/providers/onboarding/crm/applications/:id/review",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations and admins can review provider applications",
        });
      }

      const { id } = request.params as { id: string };
      const body = parse(providerApplicationReviewSchema, request.body);

      const [found] = await db
        .select()
        .from(providerOnboardingApplications)
        .where(eq(providerOnboardingApplications.id, id))
        .limit(1);

      if (!found) {
        return reply.code(404).send({
          statusCode: 404,
          code: "APPLICATION_NOT_FOUND",
          message: "Provider application not found.",
        });
      }

      // Update service-geography approvals
      const decisions = body.serviceGeographyDecisions ?? [];
      for (const dec of decisions) {
        await db
          .update(providerServiceGeographyApprovals)
          .set({
            status: dec.status,
            decisionReason: dec.reason,
            reviewedByUserId: user.id,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(providerServiceGeographyApprovals.applicationId, found.id),
              eq(providerServiceGeographyApprovals.verticalSlug, dec.verticalSlug),
              eq(providerServiceGeographyApprovals.territoryCode, dec.territoryCode),
            ),
          );
      }

      let convertedContractorId = found.convertedContractorId;

      if (body.decision === "APPROVED" && body.convertAndProvision && !convertedContractorId) {
        // Find or use applicant user id, or default to system/reviewer
        const ownerUserId = found.applicantUserId ?? user.id;

        // Provision contractor
        const [newContractor] = await db
          .insert(contractors)
          .values({
            ownerUserId,
            name: found.businessName,
            status: "VERIFIED",
            serviceAreas: found.postalCodes,
            verticalIds: found.selectedVerticals,
          })
          .returning();

        if (newContractor) {
          convertedContractorId = newContractor.id;

          // Provision technicians and credentials from roster
          const roster = await db
            .select()
            .from(providerTechnicianRosters)
            .where(eq(providerTechnicianRosters.applicationId, found.id));

          for (const r of roster) {
            let techUserId = user.id;
            const [existingUser] = await db
              .select()
              .from(users)
              .where(eq(users.email, r.email))
              .limit(1);

            if (existingUser) {
              techUserId = existingUser.id;
            } else {
              const [newUser] = await db
                .insert(users)
                .values({
                  email: r.email,
                  displayName: r.fullName,
                  passwordHash: "ONBOARDING_PLACEHOLDER_HASH",
                })
                .returning();
              if (newUser) {
                techUserId = newUser.id;
                await db.insert(userRoles).values({
                  userId: newUser.id,
                  role: "TECHNICIAN",
                });
              }
            }

            const [existingTech] = await db
              .select()
              .from(technicians)
              .where(eq(technicians.userId, techUserId))
              .limit(1);

            let newTech = existingTech;
            if (!newTech) {
              const [createdTech] = await db
                .insert(technicians)
                .values({
                  userId: techUserId,
                  contractorId: newContractor.id,
                  displayName: r.fullName,
                  active: true,
                  emergencyAvailable: r.isEmergencyAvailable,
                })
                .returning();
              newTech = createdTech;
            } else {
              const [updatedTech] = await db
                .update(technicians)
                .set({
                  contractorId: newContractor.id,
                  displayName: r.fullName,
                  active: true,
                  emergencyAvailable: r.isEmergencyAvailable,
                })
                .where(eq(technicians.id, newTech.id))
                .returning();
              newTech = updatedTech;
            }

            if (newTech) {
              const [existingCred] = await db
                .select()
                .from(credentials)
                .where(
                  and(
                    eq(credentials.technicianId, newTech.id),
                    eq(credentials.code, r.tradeLicenseCode),
                  ),
                )
                .limit(1);

              if (!existingCred) {
                await db.insert(credentials).values({
                  technicianId: newTech.id,
                  code: r.tradeLicenseCode,
                  status: "VERIFIED",
                  verificationSource: "MANUAL_AUDIT",
                  regulatorReference: r.licenseNumber,
                  verifiedByUserId: user.id,
                  verifiedAt: new Date(),
                  checkedAt: new Date(),
                  expiryDate: r.licenseExpiry,
                });
              }
            }
          }

          // Link approvals to contractor
          await db
            .update(providerServiceGeographyApprovals)
            .set({ contractorId: newContractor.id })
            .where(eq(providerServiceGeographyApprovals.applicationId, found.id));
        }
      }

      const finalStatus =
        body.decision === "APPROVED"
          ? "APPROVED"
          : body.decision === "REJECTED"
            ? "REJECTED"
            : "UNDER_REVIEW";

      const [updated] = await db
        .update(providerOnboardingApplications)
        .set({
          status: finalStatus,
          reviewNotes: body.reviewNotes,
          reviewedByUserId: user.id,
          convertedContractorId,
          updatedAt: new Date(),
        })
        .where(eq(providerOnboardingApplications.id, found.id))
        .returning();

      if (!updated) {
        return reply.code(500).send({
          statusCode: 500,
          code: "UPDATE_FAILED",
          message: "Failed to update review status.",
        });
      }

      return reply.code(200).send({
        applicationId: updated.id,
        status: updated.status,
        convertedContractorId: updated.convertedContractorId,
        message: `Application status updated to '${updated.status}'.`,
      });
    },
  );
}
