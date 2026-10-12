import type { FastifyPluginAsync } from "fastify";
import {
  db,
  eq,
  and,
  verticals,
  serviceCategories,
  issueTypes,
} from "@marketplace/database";

export const intakeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/v1/verticals",
    async () =>
      await db
        .select({
          id: verticals.id,
          slug: verticals.slug,
          name: verticals.name,
          config: verticals.config,
        })
        .from(verticals)
        .where(eq(verticals.active, true))
        .orderBy(verticals.name),
  );

  app.get("/v1/verticals/:slug/intake", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const vertical = await db.query.verticals.findFirst({
      where: and(eq(verticals.slug, slug), eq(verticals.active, true)),
      columns: { id: true, name: true },
    });
    if (!vertical)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Vertical not found" });

    let categories = await db
      .select({
        id: serviceCategories.id,
        slug: serviceCategories.slug,
        name: serviceCategories.name,
      })
      .from(serviceCategories)
      .where(
        and(
          eq(serviceCategories.verticalId, vertical.id),
          eq(serviceCategories.active, true),
        ),
      )
      .orderBy(serviceCategories.name);

    if (categories.length === 0) {
      const [insertedCat] = await db
        .insert(serviceCategories)
        .values({
          verticalId: vertical.id,
          slug: "general-service",
          name: "General Service",
        })
        .returning({
          id: serviceCategories.id,
          slug: serviceCategories.slug,
          name: serviceCategories.name,
        });
      if (insertedCat) {
        await db.insert(issueTypes).values({
          categoryId: insertedCat.id,
          slug: "general-repair",
          name: "General Repair & Diagnostic",
        });
        categories = [insertedCat];
      }
    }

    const issues = await db
      .select({
        id: issueTypes.id,
        categoryId: issueTypes.categoryId,
        slug: issueTypes.slug,
        name: issueTypes.name,
      })
      .from(issueTypes)
      .innerJoin(
        serviceCategories,
        eq(issueTypes.categoryId, serviceCategories.id),
      )
      .where(
        and(
          eq(serviceCategories.verticalId, vertical.id),
          eq(issueTypes.active, true),
        ),
      )
      .orderBy(issueTypes.name);

    return { vertical, categories, issues };
  });
};
