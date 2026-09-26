/**
 * The three install words every page uses (onboarding, Personalize, Dashboards). Client-safe: no server imports.
 * Clicking "Start recording" is not proof of anything, so it never makes a site "live":
 *   waiting   no darwin.js tag seen and no real event yet
 *   installed the darwin.js tag for the site was found on the store's page, but no real event has arrived
 *   verified  a real (not simulated) darwin.js event arrived for the site
 */
export type InstallStatus = "waiting" | "installed" | "verified";

export const INSTALL_STATUS_LABEL: Record<InstallStatus, string> = {
  waiting: "Waiting for first event",
  installed: "Installed: tag found, no event yet",
  verified: "Verified: real event arrived",
};

/**
 * From GET /api/onboarding/verify's { verified, via } and/or whether the site has real visitors.
 * via "events" (or real visitors) → verified; via "tag" → installed; else waiting.
 */
export function installStatus(input: { verify?: { verified: boolean; via?: "events" | "tag" } | null; realVisitors?: number }): InstallStatus {
  if ((input.realVisitors ?? 0) > 0) return "verified";
  const v = input.verify;
  if (v?.verified && v.via === "events") return "verified";
  if (v?.verified && v.via === "tag") return "installed";
  return "waiting";
}
