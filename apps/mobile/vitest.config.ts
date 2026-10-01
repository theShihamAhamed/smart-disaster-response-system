import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.base";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        exclude: ["App.tsx", "index.ts", "**/*.config.ts", "dist/**"],
      },
    },
  }),
);
