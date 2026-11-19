/**
 * Paste this file into the original Chrome DevTools console on Beauty OS.
 * It only reads appointment and completed-treatment keys, then downloads a
 * JSON backup. It does not change browser storage, call the network, or
 * create a remote row.
 */
(function beautyOsLocalBackup() {
  var scheduleKey = /^beauty-os:([^:]+):schedule-appointments:v1$/;
  var completedKey = /^beauty-os:([^:]+):treatments-completed:v1$/;
  var legacyCompleted = "the-enjoye:treatments-completed";
  var keys = [];
  for (var i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
  var backup = {
    version: 1,
    readOnly: true,
    capturedAt: new Date().toISOString(),
    appointments: [],
    completedTreatments: [],
    unreadableKeys: [],
  };
  function readArray(key) {
    var raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        backup.unreadableKeys.push(key);
        return null;
      }
      return parsed;
    } catch (error) {
      backup.unreadableKeys.push(key);
      return null;
    }
  }
  function text(value) {
    return typeof value === "string" ? value : "";
  }
  function taipeiDate(iso) {
    var time = Date.parse(iso);
    if (Number.isNaN(time)) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(time));
  }
  keys.forEach(function (key) {
    if (!key) return;
    if (scheduleKey.test(key)) {
      var appointments = readArray(key);
      if (!appointments) return;
      appointments.forEach(function (row) {
        if (!row || typeof row !== "object") return;
        backup.appointments.push({
          storageKey: key,
          id: text(row.id),
          organizationId: text(row.organizationId),
          locationId: text(row.locationId),
          customerId: text(row.customerId),
          staffId: text(row.staffId),
          serviceId: text(row.serviceId),
          serviceName: text(row.serviceName),
          staffName: text(row.staffName),
          startAt: text(row.startAt),
          endAt: text(row.endAt),
          status: text(row.status),
        });
      });
    }
    if (completedKey.test(key) || key === legacyCompleted) {
      var treatments = readArray(key);
      if (!treatments) return;
      treatments.forEach(function (row) {
        if (!row || typeof row !== "object") return;
        backup.completedTreatments.push({
          storageKey: key,
          id: text(row.id),
          organizationId: text(row.organizationId),
          locationId: text(row.locationId),
          appointmentId: text(row.appointmentId),
          customerId: text(row.customerId),
          staffId: text(row.staffId),
          serviceId: text(row.serviceId),
          status: text(row.status),
          assessment: row.assessment || null,
          bodyMarkers: row.bodyMarkers || [],
          bodyMapNote: text(row.bodyMapNote),
          professionalNote: text(row.professionalNote),
          clientFeeling: text(row.clientFeeling),
          discomfortNote: text(row.discomfortNote),
          followUp: row.followUp || null,
          products: row.products || [],
          suggestedTrackingAreas: row.suggestedTrackingAreas || [],
        });
      });
    }
  });
  var report = backup.completedTreatments.map(function (treatment) {
    var appointment = backup.appointments.find(function (item) {
      return item.id === treatment.appointmentId && item.organizationId === treatment.organizationId;
    });
    return {
      appointmentId: treatment.appointmentId,
      customerId: treatment.customerId,
      organizationId: treatment.organizationId,
      locationId: treatment.locationId,
      staffId: treatment.staffId,
      serviceId: treatment.serviceId,
      serviceName: appointment ? appointment.serviceName : "",
      serviceDate: appointment ? taipeiDate(appointment.startAt) : null,
      localAppointmentFound: Boolean(appointment),
      financeComparison: "not-run",
      transferable: false,
    };
  });
  var blob = new Blob([JSON.stringify({ backup: backup, report: report }, null, 2)], {
    type: "application/json",
  });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = "beauty-os-local-backup.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  console.log("Beauty OS 本機備份已下載。沒有修改瀏覽器資料，也沒有連線。");
  console.table(report);
  return { backup: backup, report: report };
})();
