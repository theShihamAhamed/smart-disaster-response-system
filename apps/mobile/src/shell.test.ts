import { describe, expect, it } from "vitest";
import { getMobileShellCopy } from "./shell";

describe("mobile shell", () => {
  it("states the citizen and volunteer scope without implementing reporting", () => {
    const copy = getMobileShellCopy();
    expect(copy.subtitle).toContain("Citizen and volunteer");
    expect(copy.phaseNotice).toContain("Phase 2");
  });
});
