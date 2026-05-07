import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

export const auth = betterAuth({
  appName: "Market Stack",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000"
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  database: new DatabaseSync(join(dataDir, "auth.sqlite")),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  advanced: {
    cookiePrefix: "market-stack",
    database: {
      generateId: "uuid"
    }
  }
});
