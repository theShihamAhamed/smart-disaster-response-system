import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.base";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          "App.tsx",
          "index.ts",
          "src/assets.d.ts",
          "src/theme.ts",
          "src/features/hazard-reporting/composition.ts",
          "src/features/hazard-reporting/types.ts",
          "src/features/hazard-reporting/hooks/**",
          "src/features/hazard-reporting/components/**",
          "src/features/hazard-reporting/screens/**",
          "src/features/hazard-reporting/ports/**",
          "src/features/hazard-reporting/adapters/expo-*.ts",
          "src/features/hazard-reporting/adapters/photo-upload.ts",
          "**/*.config.ts",
          "dist/**",
        ],
      },
    },
  }),
);
