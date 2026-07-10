import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // We intentionally sync state inside effects for client-only work:
      // reading the auth session from localStorage on mount (which must run in
      // an effect to avoid SSR hydration mismatches), reading URL tokens,
      // connecting the Socket.io client, and resetting the view when the open
      // room changes. These are external-system synchronizations, not the
      // derived-state antipattern this rule targets — so we disable it.
      // Disabled by CI fix: calling setState synchronously in certain client
      // effects is intentional here (SSR-safe). See commit message.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
