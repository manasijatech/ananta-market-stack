import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

/** Better Auth catch-all handler for `/api/auth/*`. */
export const { GET, POST } = toNextJsHandler(auth);
