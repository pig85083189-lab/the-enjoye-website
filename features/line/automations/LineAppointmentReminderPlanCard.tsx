import {
  LINE_AUTOMATION_REMINDER_PLAN_HINT,
  LINE_AUTOMATION_REMINDER_PLAN_TITLE,
} from "@/lib/line/automations/copy";
import { buildLocalReminderDemo } from "@/lib/line/automations/appointment-reminder-schedule";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";

const KIND_LABEL = {
  day_before: "預約前一天 10:00",
  hours_before_3: "預約前 3 小時",
} as const;

export function LineAppointmentReminderPlanCard({ enabled }: { enabled: boolean }) {
  const jobs = buildLocalReminderDemo({ enabled });

  return (
    <section
      data-line-appointment-reminder-plan
      className="rounded-[20px] border border-border bg-[#FFFCFB] p-4 sm:p-5"
    >
      <h2 className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_REMINDER_PLAN_TITLE}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">
        {LINE_AUTOMATION_REMINDER_PLAN_HINT}
      </p>
      <ul className="mt-3 space-y-2">
        {jobs.map((job) => {
          const display = formatTaipeiAppointmentDisplay(job.fireAt, job.fireAt);
          return (
            <li
              key={job.key}
              data-line-reminder-job={job.kind}
              data-line-reminder-status={job.status}
              className="rounded-2xl bg-white px-4 py-3 text-[13px]"
            >
              <p className="font-medium text-text">{KIND_LABEL[job.kind]}</p>
              <p className="mt-1 text-secondary-text">
                {display.date} {display.time.slice(0, 5)} · {job.reason}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
