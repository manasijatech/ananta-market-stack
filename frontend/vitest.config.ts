import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["lib/adaptive-workspace/chat-events.test.ts"]
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname)
        }
    }
});
