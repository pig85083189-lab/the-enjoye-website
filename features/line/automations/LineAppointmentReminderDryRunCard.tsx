import {
  LINE_AUTOMATION_DRY_RUN_BADGE,
  LINE_AUTOMATION_DRY_RUN_HINT,
  LINE_AUTOMATION_DRY_RUN_NOT_SENT,
  LINE_AUTOMATION_DRY_RUN_TITLE,
} from "@/lib/line/automations/copy";
import {
  createDryRunAppointment,
  dryRunJobLabel,
  runCanonicalAppointmentReminderDryRun,
} from "@/lib/line/automations/appointment-reminder-dry-run";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";

const KIND_LABEL = {
  day_before: "預約前一天 10:00",
  hours_before_3: "預約前 3 小時",
} as const;

export function LineAppointmentReminderDryRunCard() {
  const result = runCanonicalAppointmentReminderDryRun();
  const appointment = createDryRunAppointment();
  const appointmentDisplay = formatTaipeiAppointmentDisplay(appointment.startAt, appointment.startAt);

  return (
    <section
      data-line-appointment-reminder-dry-run
      data-line-dry-run-sent="false"
      className="rounded-[20px] border border-dashed border-primary/40 bg-[#FFFCFB] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_DRY_RUN_TITLE}</h2>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-medium text-primary">
          {LINE_AUTOMATION_DRY_RUN_BADGE}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">{LINE_AUTOMATION_DRY_RUN_HINT}</p>
      <p className="mt-1 text-[13px] font-medium text-text">{LINE_AUTOMATION_DRY_RUN_NOT_SENT}</p>
      <p className="mt-3 text-[13px] text-secondary-text">
        模擬預約時間：{appointmentDisplay.date} {appointmentDisplay.time.slice(0, 5)}（Asia/Taipei）
      </p>
      <ul className="mt-3 space-y-2">
        {result.jobs.map((job) => {
          const fire = formatTaipeiAppointmentDisplay(job.fireAt, job.fireAt);
          return (
            <li
              key={job.key}
              data-line-dry-run-job={job.kind}
              data-line-dry-run-status={job.status}
              className="rounded-2xl bg-white px-4 py-3 text-[13px]"
            >
              <p className="font-medium text-text">{KIND_LABEL[job.kind]}</p>
              <p className="mt-1 text-secondary-text">
                預定 {fire.date} {fire.time.slice(0, 5)} · {dryRunJobLabel(job.status)}
              </p>
              <p className="mt-1 text-secondary-text">{job.reason}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
