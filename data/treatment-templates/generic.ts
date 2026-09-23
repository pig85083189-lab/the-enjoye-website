import type { TreatmentTemplate } from "@/types/treatment-template";

/** Fallback when a specific SPA template is not ready yet */
export const GENERIC_TEMPLATE: TreatmentTemplate = {
  id: "tpl-generic",
  serviceType: "GENERIC",
  name: "通用療程",
  description: "基本療程紀錄模板",
  isGeneric: true,
  assessmentOptions: ["緊繃", "敏感", "水腫", "循環較差", "需加強", "其他"],
  bodyMapType: "GENERIC",
  bodyAreas: [
    { id: "area_general", label: "主要服務區域", cx: 100, cy: 150, r: 28 },
  ],
  bodyConditions: ["緊繃", "敏感", "水腫", "循環較差", "需加強", "其他"],
  operationGroups: [
    {
      id: "general",
      title: "一般操作",
      items: [
        { id: "op-general-prep", label: "清潔／準備" },
        { id: "op-general-main", label: "主要手技" },
        { id: "op-general-device", label: "儀器輔助" },
        { id: "op-general-finish", label: "收尾保養" },
      ],
    },
  ],
  products: [
    { id: "prod-generic-oil", label: "按摩精油" },
    { id: "prod-generic-cream", label: "保養霜" },
    { id: "prod-generic-other", label: "其他" },
  ],
  quickPhrases: ["狀況穩定", "操作後改善", "客人反應良好", "建議持續追蹤"],
  quickPhraseTextMap: {
    狀況穩定: "今日狀況大致穩定",
    操作後改善: "操作後有所改善",
    客人反應良好: "客人反應良好",
    建議持續追蹤: "建議後續持續追蹤",
  },
  followUpOptions: ["整體狀況", "敏感", "循環", "其他"],
  standardProtocol: ["op-general-prep", "op-general-main", "op-general-finish"],
  photoGuidelines: "請盡量保持相同角度與光線，方便後續比較。",
};
