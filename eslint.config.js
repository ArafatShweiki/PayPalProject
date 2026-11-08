import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "test-results-live/**",
      "playwright-report-live/**",
      ".temp/**",
      ".vercel/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["tests/live/**/*.ts"],
    // Playwright requires destructured fixture parameters, including empty ones.
    rules: { "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }] },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
