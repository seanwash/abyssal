import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // A seeded random generator and an integer hash are bit arithmetic by definition.
      files: ["shared/rng.ts"],
      rules: { "no-bitwise": "off" },
    },
  ],
});
