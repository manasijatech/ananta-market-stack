"use strict";

try {
    require("better-sqlite3");
} catch {
    const { execSync } = require("node:child_process");
    console.warn(
        "better-sqlite3 native binding is missing or incompatible; rebuilding for",
        process.version
    );
    execSync("npm rebuild better-sqlite3", { stdio: "inherit" });
    require("better-sqlite3");
}
