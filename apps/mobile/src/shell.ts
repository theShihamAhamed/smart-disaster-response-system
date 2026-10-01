export interface MobileShellCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly phaseNotice: string;
}

export function getMobileShellCopy(): MobileShellCopy {
  return {
    title: "Disaster Coordination",
    subtitle: "Citizen and volunteer mobile application",
    phaseNotice: "Phase 0 shell — hazard-reporting workflow begins in Phase 2.",
  };
}
