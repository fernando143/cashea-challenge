import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.{ts,js,mjs}"],
        },
      },
    ],
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "unit-test-only-secret",
      PGHOST: "127.0.0.1",
      PGPORT: "5432",
      PGUSER: "cashea",
      PGPASSWORD: "cashea",
      PGDATABASE: "cashea_test",
    },
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      include: ["src/**/*.ts", "frontend/**/*.{js,mjs}"],
      exclude: [
        "src/server.ts",
        "src/repositories/types.ts",
        "frontend/main.mjs",
        "scripts/**/*.ts",
      ],
      reporter: ["text", "html", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
