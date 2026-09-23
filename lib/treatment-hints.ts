import type { Customer } from "@/types";
import type { TreatmentAssessment, TreatmentDraft, TreatmentFollowUp } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";
import { getCompletedTreatmentsForCustomer } from "@/lib/treatment-draft";

export interface PreviousTreatmentHints {
  concerns: string[];
  followUpTags: string[];
  products: string[];
  assessment: TreatmentAssessment | null;
  followUp: TreatmentFollowUp | null;
  source: "completed" | "customer";
}

/** Map free-text notes → assessment / follow-up options when possible */
function mapNotesToOptions(notes: string[], options: string[]): string[] {
  const matched = new Set<string>();
  for (const note of notes) {
    for (const option of options) {
      if (note.includes(option) || option.includes(note.replace(/較緊|狀況|容易/g, ""))) {
        matched.add(option);
      }
    }
    if (note.includes("腋下") && options.includes("腋下緊繃")) matched.add("腋下緊繃");
    if (note.includes("外擴") && options.includes("外擴")) matched.add("外擴");
    if ((note.includes("經前") || note.includes("經期")) && options.includes("經前脹痛")) {
      matched.add("經前脹痛");
    }
    if (note.includes("右") && note.includes("腋") && options.includes("右側腋下")) {
      matched.add("右側腋下");
    }
    if (note.includes("左") && note.includes("腋") && options.includes("左側腋下")) {
      matched.add("左側腋下");
    }
    if (note.includes("胸上緣") && options.includes("胸上緣")) matched.add("胸上緣");
  }
  return [...matched];
}

/** Map follow-up tags → body area labels for suggested tracking (not markers) */
export function mapFollowUpToSuggestedAreas(
  tags: string[],
  template: TreatmentTemplate,
): string[] {
  const labels = new Set<string>();
  for (const tag of tags) {
    for (const area of template.bodyAreas) {
      if (
        tag.includes(area.label) ||
        area.label.includes(tag.replace(/側|右側|左側/g, "")) ||
        (tag.includes("右") && tag.includes("腋") && area.id === "right_armpit") ||
        (tag.includes("左") && tag.includes("腋") && area.id === "left_armpit") ||
        (tag.includes("胸上緣") && area.label.includes("上緣")) ||
        (tag.includes("胸外側") && area.label.includes("外側"))
      ) {
        labels.add(area.label);
      }
    }
    if (tag === "外擴" || tag === "大小胸" || tag === "敏感" || tag === "水腫") {
      // keep as text suggestion even without exact area
      labels.add(tag);
    }
  }
  return [...labels];
}

export function getPreviousTreatmentHints(
  customer: Customer,
  template: TreatmentTemplate,
): PreviousTreatmentHints {
  const completed = getCompletedTreatmentsForCustomer(
    customer.organizationId,
    customer.id,
  );
  const latest: TreatmentDraft | undefined = completed[0];

  if (latest) {
    return {
      concerns:
        latest.assessment.concerns.length > 0
          ? latest.assessment.concerns
          : mapNotesToOptions(customer.lastServiceNotes, template.assessmentOptions),
      followUpTags:
        latest.followUp.tags.length > 0
          ? latest.followUp.tags
          : mapNotesToOptions(customer.trackingFocus, template.followUpOptions),
      products: latest.products.filter((id) =>
        template.products.some((product) => product.id === id),
      ),
      assessment: latest.assessment,
      followUp: latest.followUp,
      source: "completed",
    };
  }

  const concerns = mapNotesToOptions(customer.lastServiceNotes, template.assessmentOptions);
  const followUpTags = mapNotesToOptions(customer.trackingFocus, template.followUpOptions);

  return {
    concerns,
    followUpTags,
    products: [],
    assessment:
      concerns.length > 0
        ? {
            concerns,
            clientFocus: "",
            sensitivityLevel: 0,
            comparisonToLast: "same_as_last",
          }
        : null,
    followUp:
      followUpTags.length > 0
        ? {
            tags: followUpTags,
            suggestedDate: "",
            note: "",
            suggestNextBooking: false,
          }
        : null,
    source: "customer",
  };
}

/** Suggest follow-up tags from current assessment + body markers */
export function suggestFollowUpFromSession(
  draft: TreatmentDraft,
  template: TreatmentTemplate,
): string[] {
  const suggested = new Set<string>();
  const options = template.followUpOptions;

  for (const concern of draft.assessment.concerns) {
    for (const option of options) {
      if (concern.includes(option) || option.includes(concern)) suggested.add(option);
    }
    if (concern.includes("腋下")) {
      if (options.includes("右側腋下")) suggested.add("右側腋下");
      if (options.includes("左側腋下")) suggested.add("左側腋下");
    }
    if (concern.includes("胸上緣") && options.includes("胸上緣")) suggested.add("胸上緣");
    if (concern.includes("外擴") && options.includes("外擴")) suggested.add("外擴");
    if (concern.includes("大小胸") && options.includes("大小胸")) suggested.add("大小胸");
    if (concern.includes("經前") && options.includes("經前脹痛")) suggested.add("經前脹痛");
    if (concern.includes("水腫") && options.includes("水腫")) suggested.add("水腫");
    if (concern.includes("敏感") && options.includes("敏感")) suggested.add("敏感");
  }

  for (const marker of draft.bodyMarkers) {
    const areaLabel =
      template.bodyAreas.find((area) => area.id === marker.area)?.label ?? marker.area;
    for (const option of options) {
      if (areaLabel.includes(option.replace("側", "")) || option.includes(areaLabel)) {
        suggested.add(option);
      }
    }
    if (areaLabel.includes("右") && areaLabel.includes("腋") && options.includes("右側腋下")) {
      suggested.add("右側腋下");
    }
    if (areaLabel.includes("左") && areaLabel.includes("腋") && options.includes("左側腋下")) {
      suggested.add("左側腋下");
    }
    if (areaLabel.includes("上緣") && options.includes("胸上緣")) suggested.add("胸上緣");
    if (areaLabel.includes("外側") && options.includes("胸外側")) suggested.add("胸外側");
    for (const condition of marker.conditions) {
      if (condition.includes("外擴") && options.includes("外擴")) suggested.add("外擴");
      if (condition.includes("水腫") && options.includes("水腫")) suggested.add("水腫");
      if (condition.includes("敏感") && options.includes("敏感")) suggested.add("敏感");
    }
  }

  return options.filter((option) => suggested.has(option));
}
