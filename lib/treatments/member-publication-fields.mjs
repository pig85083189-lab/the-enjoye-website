function str(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function arr(value) {
  return Array.isArray(value) ? value.map(str).filter((item) => item).slice(0, 20) : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function add(target, key, value) {
  if (value !== null && (!Array.isArray(value) || value.length > 0)) target[key] = value;
}

/** Customer-facing snapshot. Status and completion time stay on the mirror. */
export function memberPublicationFields(treatment, consultationFields) {
  const source = obj(treatment);
  const assessment = obj(source.assessment);
  const followUp = obj(source.follow_up);
  const fields = {};
  const answers = obj(assessment.consultationAnswers);
  const definitions = Array.isArray(consultationFields) ? consultationFields : [];
  const approvedAnswers = definitions.slice(0, 30).flatMap((raw) => {
    const definition = obj(raw);
    const id = str(definition.id);
    const label = str(definition.label);
    if (!id || !label) return [];
    const rawAnswer = answers[id];
    const value = Array.isArray(rawAnswer)
      ? arr(rawAnswer).join("、")
      : typeof rawAnswer === "number" || typeof rawAnswer === "boolean"
        ? String(rawAnswer)
        : str(rawAnswer);
    return value ? [{ label, value }] : [];
  });
  if (approvedAnswers.length) fields.consultation_answers = approvedAnswers;
  add(fields, "professional_note", typeof source.professional_note === "string" && source.professional_note.trim()
    ? source.professional_note.trim().slice(0, 4000)
    : null);
  const markerDetails = Array.isArray(source.body_markers)
    ? source.body_markers.slice(0, 40).flatMap((raw) => {
      const marker = obj(raw);
      const area = str(marker.area);
      return area ? [{ area, conditions: arr(marker.conditions), note: str(marker.note) }] : [];
    })
    : [];
  if (markerDetails.length) fields.body_marker_details = markerDetails;
  add(fields, "concerns", arr(assessment.concerns));
  add(fields, "client_focus", str(assessment.clientFocus));
  add(fields, "comparison_to_last", str(assessment.comparisonToLast));
  add(fields, "sensitivity_level", typeof assessment.sensitivityLevel === "number" && Number.isFinite(assessment.sensitivityLevel)
    ? assessment.sensitivityLevel
    : null);
  add(fields, "body_markers", Array.isArray(source.body_markers)
    ? source.body_markers.map((item) => str(obj(item).area)).filter((item) => item).slice(0, 20)
    : []);
  add(fields, "body_map_note", str(source.body_map_note));
  add(fields, "discomfort_note", str(source.discomfort_note));
  add(fields, "client_feeling", str(source.client_feeling));
  add(fields, "products", Array.isArray(source.products)
    ? source.products.map((item) => str(obj(item).label) ?? str(item)).filter((item) => item).slice(0, 20)
    : []);
  add(fields, "follow_up_note", str(followUp.note));
  add(fields, "follow_up_tags", arr(followUp.tags));
  add(fields, "suggest_next_booking", typeof followUp.suggestNextBooking === "boolean" ? followUp.suggestNextBooking : null);
  add(fields, "suggested_date", str(followUp.suggestedDate));
  add(fields, "suggested_tracking_areas", arr(source.suggested_tracking_areas));
  return fields;
}
