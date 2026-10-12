import dotenv from "dotenv";
dotenv.config({
  path: [new URL("../../../.env", import.meta.url).pathname, ".env"],
});
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { errorHandler } from "./common/error-handler.js";
import { registerRoutes } from "./routes/index.js";

const app = Fastify({ logger: true });
const jwtSecret =
  process.env.JWT_SECRET ?? "dev_only_jwt_secret_must_be_32_characters_minimum";

await app.register(jwt, { secret: jwtSecret });
await app.register(helmet, {
  contentSecurityPolicy: process.env.NODE_ENV === "production",
});
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.endsWith(".skilledhire.ca") ||
      origin === "https://skilledhire.ca"
    )
      return cb(null, true);
    cb(new Error("CORS_NOT_ALLOWED"), false);
  },
  credentials: true,
});

// Register all modular routes
await registerRoutes(app);

// Global Error Handler
app.setErrorHandler(errorHandler);

export { app };

if (process.env.API_NO_LISTEN !== "true") {
  await app.listen({
    port: Number(process.env.API_PORT ?? 4000),
    host: "0.0.0.0",
  });
}
