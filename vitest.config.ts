import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "**/*.d.ts",
        "**/*.config.*",
        // Entry points and orchestration — tested via integration, not unit tests
        "src/index.ts",
        "src/tools.ts",
        // API/network/filesystem code — requires mocking external systems
        "src/lib/jira/client.ts",
        "src/lib/git/clone.ts",
        "**/*.test.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
