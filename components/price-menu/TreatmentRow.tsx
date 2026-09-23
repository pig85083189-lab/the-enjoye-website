import {
  formatDuration,
  formatPrice,
  hasExperiencePrice,
  type MenuService,
} from "@/data/services";

type TreatmentRowProps = {
  service: MenuService;
};

export function TreatmentRow({ service }: TreatmentRowProps) {
  const duration = formatDuration(service.duration);
  const amount = hasExperiencePrice(service)
    ? service.experiencePrice
    : null;

  return (
    <div className="pm-menu-row">
      <h4 className="pm-menu-row__name">{service.name}</h4>
      <span className="pm-menu-row__leader" aria-hidden />
      {duration ? (
        <span className="pm-menu-row__duration">{duration}</span>
      ) : (
        <span className="pm-menu-row__duration pm-menu-row__duration--empty" />
      )}
      <div className="pm-menu-row__price">
        <span
          className={`pm-menu-row__amount ${amount == null ? "is-pending" : ""}`}
        >
          {formatPrice(amount)}
        </span>
        <span className="pm-menu-row__xp">體驗價</span>
      </div>
    </div>
  );
}
