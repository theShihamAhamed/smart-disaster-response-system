import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.base";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "node",
      coverage: {
        exclude: ["src/server.ts", "prisma/**", "**/*.config.ts", "dist/**"],
      },
    },
  }),
);
