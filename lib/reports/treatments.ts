import { listCompletedTreatmentsForOrganization } from "@/lib/repositories/local-treatment-repository";
import { listOpenTreatmentDrafts } from "@/lib/treatment-draft";
import type { ReportQuery, TreatmentSummary } from "./domain";
import { isInstantInRange } from "./date-range";

function matchesLocation(
  locationId: string | undefined,
  filterLocationId: string | undefined,
): boolean {
  if (!filterLocationId) return true;
  if (!locationId) return true;
  return locationId === filterLocationId;
}

export function getTreatmentSummary(query: ReportQuery): TreatmentSummary {
  if (!query.organizationId) throw new Error("organizationId is required");

  const completed = listCompletedTreatmentsForOrganization(
    query.organizationId,
  ).filter(
    (t) =>
      t.organizationId === query.organizationId &&
      t.status === "completed" &&
      matchesLocation(t.locationId, query.locationId) &&
      isInstantInRange(t.updatedAt, query.range),
  );

  const drafts = listOpenTreatmentDrafts(query.organizationId).filter((t) =>
    matchesLocation(t.locationId, query.locationId),
  );

  return {
    completedCount: completed.length,
    openDraftCount: drafts.length,
  };
}
