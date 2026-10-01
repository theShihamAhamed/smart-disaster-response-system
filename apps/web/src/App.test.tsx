import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("officer web shell", () => {
  it("presents separate DMC and district officer areas", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "DMC Duty Officer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "District Officer" })).toBeInTheDocument();
    expect(screen.getByText(/intentionally not implemented/i)).toBeInTheDocument();
  });
});
