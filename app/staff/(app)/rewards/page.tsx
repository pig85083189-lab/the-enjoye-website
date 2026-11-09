"use client";
import { useState } from "react";
import Link from "next/link";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { Gift, Coins, TicketPercent, Gamepad2, ShieldCheck, ArrowLeft } from "lucide-react";

const sections = [
  { id:"overview", label:"總覽" },{ id:"coins", label:"會員幣" },
  { id:"coupons", label:"優惠券" },{ id:"pet", label:"寵物遊戲" }
] as const;
type Section = (typeof sections)[number]["id"];
export default function RewardsCenterPage() {
  const [section,setSection]=useState<Section>("overview");
  const { membership, organization, currentLocation }=useOrganization();
  const role=String(membership?.role ?? "").toUpperCase();
  const canManage=["OWNER","ADMIN","MANAGER","ORG_OWNER","ORG_ADMIN","LOCATION_MANAGER","PLATFORM_ADMIN"].includes(role);
  return <div className="space-y-6">
    <Link href="/staff/more" className="inline-flex items-center gap-2 text-sm text-secondary-text hover:text-primary"><ArrowLeft className="h-4 w-4"/>返回更多</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs tracking-[.22em] text-primary">BEAUTY OS · MEMBERSHIP</p><h1 className="mt-2 text-3xl font-semibold">會員獎勵中心</h1><p className="mt-2 text-sm text-secondary-text">{organization.name} · {currentLocation?.name ?? "全部門市"} · 介面預覽</p></div><span className="rounded-full bg-primary-light px-4 py-2 text-xs text-primary">尚未啟用獎勵發放</span></div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="獎勵管理分頁">{sections.map(s=><button key={s.id} role="tab" aria-selected={section===s.id} onClick={()=>setSection(s.id)} className={`rounded-xl px-4 py-3 text-sm transition-colors ${section===s.id?"bg-primary text-white":"border border-border bg-surface text-text"}`}>{s.label}</button>)}</div>
    {section==="overview"&&<div className="grid gap-4 sm:grid-cols-2">{[{icon:Coins,title:"會員幣帳本",description:"發放、扣除、回沖與交易紀錄"},{icon:TicketPercent,title:"優惠券管理",description:"領取、兌換、到期與核銷"},{icon:Gamepad2,title:"ENJOYE PET",description:"寵物角色、每日任務與裝扮"},{icon:Gift,title:"活動與獎勵",description:"活動規則、發放上限與成效"}].map(x=><div key={x.title} className="rounded-2xl border border-border bg-surface p-6"><x.icon className="mb-4 h-7 w-7 text-primary"/><h2 className="text-lg font-semibold">{x.title}</h2><p className="mt-2 text-sm text-secondary-text">{x.description}</p><p className="mt-5 text-xs text-primary">待串接資料庫</p></div>)}</div>}
    {section==="coins"&&<div className="rounded-2xl border border-border bg-surface p-6"><Coins className="mb-3 text-primary"/><h2 className="text-xl font-semibold">會員幣規則</h2><p className="mt-2 text-sm text-secondary-text">預計支援每日簽到、任務獎勵、首次有效療程與到期規則。</p><div className="mt-5 space-y-3">{["每日簽到","每日任務","連續簽到","首次有效療程"].map(x=><div key={x} className="flex justify-between border-b border-border pb-3 text-sm"><span>{x}</span><span className="text-secondary-text">尚未設定</span></div>)}</div></div>}
    {section==="coupons"&&<div className="rounded-2xl border border-border bg-surface p-6"><TicketPercent className="mb-3 text-primary"/><h2 className="text-xl font-semibold">優惠券設定</h2><p className="mt-2 text-sm leading-7 text-secondary-text">規劃建立折價券、指定適用課程與門市、兌換幣數、使用期限及一次性核銷。尚無真實優惠券資料。</p><div className="mt-5 rounded-xl bg-background p-4 text-sm text-secondary-text">目前沒有已啟用的優惠券。</div></div>}
    {section==="pet"&&<div className="rounded-2xl border border-border bg-surface p-6"><Gamepad2 className="mb-3 text-primary"/><h2 className="text-xl font-semibold">ENJOYE PET 遊戲管理</h2><p className="mt-2 text-sm leading-7 text-secondary-text">第一版規劃奶油小熊、餵食、摸摸、裝扮、每日任務與親密度。遊戲愛心與可兌換的會員幣分開管理。</p><div className="mt-5 rounded-xl bg-background p-4 text-sm text-secondary-text">角色及任務規則尚未發布。</div></div>}
    <div className="flex gap-3 rounded-2xl border border-border bg-primary-light/40 p-5"><ShieldCheck className="h-6 w-6 shrink-0 text-primary"/><div><p className="text-sm font-semibold">安全預覽模式</p><p className="mt-1 text-sm leading-6 text-secondary-text">{canManage?"管理員設定操作將在後端權限與獎勵交易驗證完成後開放。":"目前帳號僅能查看此預覽；未授權修改獎勵規則。"}此頁不會建立優惠券、發放會員幣或修改顧客資料。</p></div></div>
  </div>;
}