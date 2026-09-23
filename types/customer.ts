/** CRM / consultation domain types — shaped for future Supabase mapping */

export type CustomerSource =
  | "instagram"
  | "facebook"
  | "google"
  | "friend"
  | "walk_in"
  | "referral"
  | "other";

export type CustomerGender = "female" | "male" | "other" | "unspecified";

export type CustomerListStatus = "normal" | "needs_follow_up" | "inactive";

export type PresetCustomerTagId =
  | "vip"
  | "new"
  | "regular"
  | "breast"
  | "body"
  | "facial"
  | "needs_follow_up"
  | "sensitive"
  | "birthday_month";

export interface CustomerTag {
  id: string;
  label: string;
  kind: "preset" | "custom";
}

export type PressurePreference = "light" | "medium" | "strong" | "therapist_choice";
export type ChatPreference = "quiet" | "chat" | "flexible";
export type TemperaturePreference = "cold" | "normal" | "hot";

export interface CustomerPreference {
  preferredStaffId?: string;
  preferredStaffName?: string;
  pressure?: PressurePreference;
  chatPreference?: ChatPreference;
  temperature?: TemperaturePreference;
  scentPreference?: string;
  scentDislikes?: string;
  sensitiveProducts?: string;
  notes?: string;
}

export type ConsultationGoalId =
  | "breast_shape"
  | "outward"
  | "sagging"
  | "asymmetry"
  | "breast_tightness"
  | "armpit_tightness"
  | "accessory_breast"
  | "body_shape"
  | "edema"
  | "shoulder_neck"
  | "waist_abdomen"
  | "hip_leg"
  | "skin"
  | "relax"
  | "other";

export interface ConsultationHealthItem {
  id: string;
  label: string;
  checked: boolean;
  note?: string;
}

export interface ConsultationFemaleCycle {
  currentStatus?: string;
  lastPeriodDate?: string;
  isRegular?: boolean | null;
  prePeriodSymptoms?: string[];
  lifeStageNotes?: string[];
  skipped?: boolean;
}

export interface ConsultationSpaHistory {
  pastServices: string[];
  lastServiceAt?: string;
  adverseReactionNote?: string;
}

export type ConsultationKind = "initial" | "update";

export interface CustomerConsultation {
  id: string;
  organizationId: string;
  customerId: string;
  kind: ConsultationKind;
  title: string;
  goals: ConsultationGoalId[];
  goalNote?: string;
  healthItems: ConsultationHealthItem[];
  femaleCycle?: ConsultationFemaleCycle;
  spaHistory?: ConsultationSpaHistory;
  preferences?: CustomerPreference;
  /** Snapshot of basic fields at consultation time */
  basicSnapshot?: Partial<{
    name: string;
    phone: string;
    birthday: string;
    lineId: string;
    email: string;
    gender: CustomerGender;
    occupation: string;
    address: string;
    source: CustomerSource;
    primaryStaffId: string;
    primaryStaffName: string;
  }>;
  customerConfirmed: boolean;
  signatureText?: string;
  consultedAt: string;
  consultedBy: string;
  consultedByName: string;
  customerConfirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerNote {
  id: string;
  organizationId: string;
  customerId: string;
  content: string;
  pinned: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export type CustomerPhotoKind = "before" | "after" | "follow_up" | "other";

export interface CustomerPhoto {
  id: string;
  organizationId: string;
  customerId: string;
  treatmentId?: string;
  serviceName?: string;
  kind: CustomerPhotoKind;
  /** Placeholder URL or path — never base64 in localStorage */
  placeholderUrl: string;
  staffName?: string;
  takenAt: string;
  createdAt: string;
}

export type CrmAppointmentStatus =
  | "booked"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export interface CrmAppointment {
  id: string;
  organizationId: string;
  locationId?: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt?: string;
  status: CrmAppointmentStatus;
  notes?: string[];
  durationMinutes?: number;
  membership?: import("./index").MembershipTier;
  remainingSessions?: number;
}

export const PRESET_CUSTOMER_TAGS: Record<PresetCustomerTagId, CustomerTag> = {
  vip: { id: "vip", label: "VIP", kind: "preset" },
  new: { id: "new", label: "新客", kind: "preset" },
  regular: { id: "regular", label: "熟客", kind: "preset" },
  breast: { id: "breast", label: "美胸", kind: "preset" },
  body: { id: "body", label: "體雕", kind: "preset" },
  facial: { id: "facial", label: "臉部", kind: "preset" },
  needs_follow_up: { id: "needs_follow_up", label: "需追蹤", kind: "preset" },
  sensitive: { id: "sensitive", label: "敏感", kind: "preset" },
  birthday_month: { id: "birthday_month", label: "生日月", kind: "preset" },
};

export const CUSTOMER_SOURCE_LABEL: Record<CustomerSource, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  friend: "朋友介紹",
  walk_in: "路過",
  referral: "舊客介紹",
  other: "其他",
};

export const CONSULTATION_GOAL_LABEL: Record<ConsultationGoalId, string> = {
  breast_shape: "胸型",
  outward: "外擴",
  sagging: "下垂",
  asymmetry: "大小胸",
  breast_tightness: "胸部緊繃",
  armpit_tightness: "腋下緊繃",
  accessory_breast: "副乳",
  body_shape: "體態",
  edema: "水腫",
  shoulder_neck: "肩頸",
  waist_abdomen: "腰腹",
  hip_leg: "臀腿",
  skin: "肌膚",
  relax: "放鬆",
  other: "其他",
};

export const HEALTH_ITEM_DEFS: Array<{ id: string; label: string }> = [
  { id: "pregnant", label: "目前是否懷孕" },
  { id: "breastfeeding", label: "目前是否哺乳" },
  { id: "recent_surgery", label: "近期是否接受手術" },
  { id: "skin_allergy", label: "是否有皮膚過敏" },
  { id: "bruises_easily", label: "是否容易瘀青" },
  { id: "medication", label: "是否正在服用藥物" },
  { id: "special_condition", label: "是否有特殊疾病或需注意狀況" },
  { id: "implant", label: "是否有植入式醫療裝置" },
  { id: "recent_aesthetic", label: "近期是否接受醫美療程" },
  { id: "wound_inflammation", label: "目前是否有傷口或皮膚發炎" },
];

export const PRESSURE_LABEL: Record<PressurePreference, string> = {
  light: "輕",
  medium: "適中",
  strong: "較強",
  therapist_choice: "依美容師判斷",
};

export const CHAT_PREF_LABEL: Record<ChatPreference, string> = {
  quiet: "安靜休息",
  chat: "可以聊天",
  flexible: "依當天狀況",
};

export const TEMPERATURE_LABEL: Record<TemperaturePreference, string> = {
  cold: "怕冷",
  normal: "正常",
  hot: "怕熱",
};

export const CRM_APPOINTMENT_STATUS_LABEL: Record<CrmAppointmentStatus, string> = {
  booked: "已預約",
  confirmed: "已確認",
  in_progress: "進行中",
  completed: "完成",
  cancelled: "取消",
  no_show: "未到",
  rescheduled: "改期",
};
