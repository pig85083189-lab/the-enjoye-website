"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import { createId } from "@/lib/treatment-draft";
import type { BodyMarker } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";

interface BodyMapStepProps {
  template: TreatmentTemplate;
  markers: BodyMarker[];
  bodyMapNote: string;
  suggestedTrackingAreas: string[];
  onMarkersChange: (markers: BodyMarker[]) => void;
  onNoteChange: (note: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

const sections = [
  { id: "head", label: "頭", symbol: "◯", areas: ["額頭", "左太陽穴", "右太陽穴", "左眼周", "右眼周", "左臉頰", "右臉頰", "下巴", "頭頂", "後腦", "後頸"] },
  { id: "breast", label: "胸部", symbol: "♡", areas: ["右腋下", "左腋下", "右胸上緣", "左胸上緣", "右胸外側", "左胸外側", "右胸下緣", "左胸下緣", "胸骨中央"] },
  { id: "body", label: "身體", symbol: "♧", areas: ["肩頸", "左上臂", "右上臂", "腹部", "左腰", "右腰", "左大腿", "右大腿", "左小腿", "右小腿"] },
  { id: "womb", label: "子宮", symbol: "◇", areas: ["下腹中央", "左下腹", "右下腹", "骨盆區", "腰骶部"] },
  { id: "back", label: "後背", symbol: "♧", areas: ["後頸", "左肩胛", "右肩胛", "上背", "下背", "左腰背", "右腰背"] },
] as const;
const symptoms = ["緊繃", "敏感", "水腫", "循環較差", "痠痛", "硬塊／結節", "需加強", "其他"];
const spots: Record<string, Array<[number, number]>> = {
  head: [[515,470],[278,550],[745,550],[380,645],[650,645],[366,770],[660,770],[510,960],[1420,215],[1420,655],[1420,1000]],
  breast: [[89,152],[211,152],[105,120],[195,120],[73,181],[227,181],[107,210],[193,210],[150,171]],
  body: [[150,70],[92,124],[208,124],[150,195],[110,225],[190,225],[115,300],[185,300],[115,370],[185,370]],
  womb: [[150,200],[105,195],[195,195],[150,245],[150,290]],
  back: [[150,66],[99,133],[201,133],[150,169],[150,257],[109,283],[191,283]],
};
function Anatomy({section}:{section:string}) {
  const back=section==="back",head=section==="head",breast=section==="breast",womb=section==="womb";
  return <svg viewBox="0 0 300 420" className="mx-auto h-[350px] w-full max-w-[310px]" aria-hidden="true">
    <defs><linearGradient id="bodyFill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFF5EF"/><stop offset="1" stopColor="#F8DFDA"/></linearGradient></defs>
    <g fill="url(#bodyFill)" stroke="#956D6B" strokeWidth="2.4" strokeLinejoin="round">
      <ellipse cx="150" cy="74" rx="44" ry="55"/>
      <path d="M131 124 L130 145 Q108 154 78 164 Q58 177 54 217 L42 299 Q42 318 56 320 L75 243 L84 337 Q96 367 107 405 L193 405 Q204 367 216 337 L225 243 L244 320 Q258 318 258 299 L246 217 Q242 177 222 164 Q192 154 170 145 L169 124" />
    </g>
    {head ? <g fill="none" stroke="#C89D9C" strokeWidth="1.5"><path d="M117 72 Q150 60 183 72"/><path d="M123 105 Q150 119 177 105"/></g> : null}
    {breast ? <g fill="#EAB5BC" fillOpacity=".55" stroke="#B9828A" strokeWidth="1.4"><ellipse cx="111" cy="203" rx="39" ry="30"/><ellipse cx="189" cy="203" rx="39" ry="30"/></g> : null}
    {womb ? <g fill="#E8B2BA" stroke="#B9828A" strokeWidth="2"><path d="M131 227 Q111 208 98 211 Q99 234 127 239 Q129 258 150 270 Q171 258 173 239 Q201 234 202 211 Q189 208 169 227 Q150 237 131 227Z"/></g> : null}
    {back ? <g fill="none" stroke="#C89D9C" strokeWidth="2"><path d="M150 152 L150 310 M89 170 Q120 205 145 175 M211 170 Q180 205 155 175"/></g> : null}
    {!head&&!breast&&!womb&&!back ? <g fill="none" stroke="#D9A8A9" strokeWidth="1.5"><path d="M150 176 L150 274 M106 274 Q150 289 194 274"/></g> : null}
  </svg>;
}

export function BodyMapStep({template,markers,bodyMapNote,suggestedTrackingAreas,onMarkersChange,onNoteChange,onBack,onNext,onSkip}:BodyMapStepProps) {
  const [section,setSection]=useState<string>(template.bodyMapType==="BREAST"?"breast":"body");
  const [area,setArea]=useState<string|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [note,setNote]=useState("");
  const current=sections.find(s=>s.id===section)!;
  const existing=useMemo(()=>markers.filter(m=>current.areas.some(a=>a===m.area)),[markers,current]);
  function choose(next:string) {
    setArea(next);
    const found=markers.find(m=>m.area===next);
    setSelected(found?.conditions??[]);
    setNote(found?.note??"");
  }
  function save() {
    if(!area||!selected.length)return;
    const old=markers.find(m=>m.area===area);
    const updated:BodyMarker={id:old?.id??createId("marker"),area,conditions:selected,note};
    onMarkersChange([...markers.filter(m=>m.area!==area),updated]);
    setArea(null);setSelected([]);setNote("");
  }
  function remove(name:string) {onMarkersChange(markers.filter(m=>m.area!==name));if(area===name)setArea(null);}
  return <div>
    <header className="mb-5"><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold text-text">部位紀錄</h1><span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">選填</span></div>
    <p className="mt-2 text-[15px] text-secondary-text">選擇部位圖片，點選今天需要關注的位置並標記症狀。</p></header>
    <Card padding="md" className="mb-4">
      <h2 className="mb-3 text-base font-semibold text-text">選擇紀錄部位</h2>
      <div className="grid grid-cols-5 gap-2">{sections.map(s=><button key={s.id} type="button" onClick={()=>{setSection(s.id);setArea(null);}} aria-pressed={section===s.id} className={`min-h-20 rounded-xl border px-1 py-2 text-center text-sm font-medium transition-colors ${section===s.id?"border-[#B87981] bg-[#B87981] text-white":"border-[#F0DFDF] bg-[#FBF5F5] text-[#85555F]"}`}><span className="mb-1 block text-xl" aria-hidden="true">{s.symbol}</span>{s.label}</button>)}</div>
    </Card>
    <Card padding="md" className="mb-4">
      <h2 className="text-base font-semibold text-text">{current.label}症狀標記</h2>
      <p className="mt-1 text-sm text-secondary-text">點選圖片中的症狀區域，再選擇症狀（可複選）。左右以顧客本人方向為準。</p>
      <div className={`mt-4 grid gap-4 ${section==="head"?"xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]":"lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        <div className={`relative mx-auto w-full ${section==="head"?"max-w-[800px]":"max-w-[310px]"}`}>
          {section==="head" ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" aria-label="頭部正面與背面症狀點選圖" role="group">
            <image href="/ead-bodymap.png" x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            {[
              "M365 365 Q515 290 670 360 Q720 440 655 525 Q515 580 370 520Z",
              "M225 495 Q265 465 305 510 L320 640 Q270 685 230 630Z",
              "M705 495 Q755 465 790 520 L800 635 Q750 685 700 630Z",
              "M305 585 Q385 560 450 620 Q460 705 365 710 Q295 675 305 585Z",
              "M580 585 Q655 560 725 615 Q735 705 635 710 Q570 680 580 585Z",
              "M285 735 Q365 700 435 755 Q455 850 375 900 Q290 870 285 735Z",
              "M590 735 Q675 700 740 755 Q755 850 670 900 Q585 870 590 735Z",
              "M440 925 Q510 895 580 925 Q590 1000 510 1020 Q440 1010 440 925Z",
              "M1235 80 Q1420 20 1610 90 Q1640 280 1420 365 Q1230 310 1235 80Z",
              "M1190 400 Q1420 340 1650 400 Q1710 740 1560 855 Q1420 925 1270 850 Q1130 710 1190 400Z",
              "M1290 870 Q1420 845 1550 875 L1550 1070 Q1420 1110 1290 1070Z",
            ].map((d,i)=>{const a=current.areas[i];const active=area===a;const recorded=markers.some(m=>m.area===a);return <path key={a} d={d} role="button" tabIndex={0} aria-label={`選擇${a}`} onClick={()=>choose(a)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(a);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.22:recorded?0.14:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="8" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
          </svg> : <><Anatomy section={section}/>{current.areas.map((a,i)=>{const p=spots[section][i];const recorded=markers.some(m=>m.area===a);return <button key={a} type="button" title={a} aria-label={`選擇${a}`} onClick={()=>choose(a)} style={{left:`${p[0]/300*100}%`,top:`${p[1]/420*100}%`}} className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold shadow-sm ${area===a?"border-[#8F4E60] bg-[#B87981] text-white":recorded?"border-[#AD6577] bg-[#E8B2BA] text-[#6F3444]":"border-white bg-[#F6D9DC]/90 text-[#85555F]"}`}>{i+1}</button>})}</>}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[#754852]">部位位置</p>
          <div className="flex flex-wrap gap-2">{current.areas.map((a,i)=><button key={a} type="button" onClick={()=>choose(a)} className={`rounded-full border px-3 py-2 text-sm ${area===a?"border-[#B87981] bg-[#F4DEE1] text-[#783F4F]":"border-[#F0DFDF] text-text"}`}>{i+1}. {a}{markers.some(m=>m.area===a)?" ✓":""}</button>)}</div>
          {area?<div className="rounded-2xl border border-[#F0DFDF] bg-[#FBF6F6] p-4"><h3 className="font-semibold text-[#754852]">{area}</h3><p className="mt-2 text-xs text-secondary-text">症狀（可複選）</p><div className="mt-2 flex flex-wrap gap-2">{Array.from(new Set([...template.bodyConditions,...symptoms])).map(c=><button key={c} type="button" aria-pressed={selected.includes(c)} onClick={()=>setSelected(old=>old.includes(c)?old.filter(x=>x!==c):[...old,c])} className={`rounded-full border px-3 py-2 text-sm ${selected.includes(c)?"border-[#B87981] bg-[#B87981] text-white":"border-[#E6C9CB] bg-white text-text"}`}>{c}</button>)}</div><textarea aria-label="部位症狀備註" value={note} onChange={e=>setNote(e.target.value)} rows={2} className="mt-3 w-full rounded-xl border border-[#E6C9CB] bg-white p-3 text-sm" placeholder="部位備註（選填）"/><div className="mt-3 flex gap-2"><button type="button" disabled={!selected.length} onClick={save} className="rounded-xl bg-[#B87981] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">儲存標記</button><button type="button" onClick={()=>setArea(null)} className="rounded-xl border px-4 py-2 text-sm">取消</button></div></div>:<p className="rounded-xl bg-[#FBF5F5] p-3 text-sm text-secondary-text">點選圖片上的症狀區域開始紀錄。</p>}
        </div>
      </div>
    </Card>
    <Card padding="md" className="mb-4"><h2 className="text-base font-semibold text-text">已標記部位（{markers.length}）</h2>{markers.length?<div className="mt-3 flex flex-wrap gap-2">{markers.map(m=><div key={m.id} className="flex items-center gap-2 rounded-xl bg-[#FBF0F1] px-3 py-2 text-sm"><button type="button" onClick={()=>{const match=sections.find(s=>s.areas.some(a=>a===m.area));if(match)setSection(match.id);choose(m.area);}} className="text-left text-[#754852]">{m.area}：{m.conditions.join("、")}</button><button type="button" onClick={()=>remove(m.area)} aria-label={`移除${m.area}`} className="text-[#B87981]">×</button></div>)}</div>:<p className="mt-2 text-sm text-secondary-text">尚未標記</p>}
      {suggestedTrackingAreas.length>0?<p className="mt-3 text-sm text-secondary-text">建議追蹤：{suggestedTrackingAreas.join("、")}</p>:null}</Card>
    <Card padding="md" className="mb-4"><label htmlFor="body-map-note" className="text-base font-semibold text-text">部位備註</label><textarea id="body-map-note" value={bodyMapNote} onChange={e=>onNoteChange(e.target.value)} rows={3} className="mt-3 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary" placeholder="記錄本次部位的感受、變化及注意事項。"/></Card>
    <StepFooter onBack={onBack} onNext={onNext} onSkip={onSkip} nextLabel="下一步：操作項目"/>
  </div>;
}
