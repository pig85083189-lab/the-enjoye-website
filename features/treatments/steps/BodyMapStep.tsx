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
  { id: "breast", label: "胸部", symbol: "♡", areas: ["右胸上緣", "右胸中央", "右胸下緣", "右胸外側", "左胸上緣", "左胸中央", "左胸下緣", "左胸外側", "腋下"] },
  { id: "body", label: "身體", symbol: "♧", areas: ["正面肩頸","正面右肩","正面左肩","正面胸口","正面右上臂","正面左上臂","正面右前臂","正面左前臂","腹部","右腰","左腰","正面右臀髖","正面左臀髖","正面右大腿","正面左大腿","正面右膝","正面左膝","正面右小腿","正面左小腿","背面肩頸","背面右肩","背面左肩","右上背","左上背","背面右上臂","背面左上臂","背面右前臂","背面左前臂","右下背","左下背","右臀","左臀","背面右大腿","背面左大腿","背面右膝","背面左膝","背面右小腿","背面左小腿"] },
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
      <div className={`mt-4 grid gap-4 ${section==="head"||section==="breast"||section==="body"?"xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]":"lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        <div className={`relative mx-auto w-full ${section==="head"||section==="breast"||section==="body"?"max-w-[800px]":"max-w-[310px]"}`}>
          {section==="head" ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" aria-label="頭部正面與背面症狀點選圖" role="group">
            <image href="/ead-bodymap.png" x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            {[
              "M 391 438 C 418 398 476 380 525 382 C 587 382 649 405 674 451 C 693 490 685 535 649 554 C 609 574 553 578 516 578 C 469 578 412 568 388 542 C 364 516 367 475 391 438 Z",
              "M 725 520 C 750 499 778 515 796 548 C 813 580 817 622 805 643 C 793 666 768 661 746 638 C 729 618 709 576 713 550 C 715 535 719 526 725 520 Z",
              "M 255 530 C 275 506 305 500 322 525 C 336 547 322 598 307 632 C 294 661 271 665 255 647 C 240 629 241 564 255 530 Z",
              "M 611 647 C 634 617 674 604 711 616 C 749 629 766 659 761 694 C 755 733 718 755 682 758 C 639 758 609 733 606 693 C 603 676 604 661 611 647 Z",
              "M 326 645 C 351 617 391 607 428 617 C 465 627 480 662 478 692 C 474 731 446 752 407 759 C 367 761 327 737 313 706 C 305 685 311 661 326 645 Z",
              "M 628 773 C 656 756 701 756 740 765 C 753 792 749 834 733 857 C 714 883 682 888 651 878 C 622 869 609 839 611 807 C 611 791 618 779 628 773 Z",
              "M 313 773 C 345 754 394 758 425 774 C 445 798 443 838 429 859 C 414 883 382 887 352 876 C 323 865 304 831 305 803 C 304 790 308 781 313 773 Z",
              "M 474 992 C 496 979 533 977 563 985 C 591 994 610 1012 598 1027 C 574 1043 529 1046 500 1041 C 473 1038 452 1025 458 1009 C 460 1001 466 997 474 992 Z",
              "M 1311 180 C 1347 149 1401 137 1455 137 C 1524 137 1592 154 1629 197 C 1661 238 1663 303 1646 353 C 1633 401 1595 444 1542 463 C 1494 481 1420 480 1366 462 C 1318 443 1292 407 1282 361 C 1267 308 1279 223 1311 180 Z",
              "M 1320 516 C 1360 490 1422 484 1482 487 C 1553 488 1627 501 1662 546 C 1691 586 1690 664 1674 727 C 1656 803 1607 851 1556 875 C 1511 898 1446 906 1390 892 C 1329 878 1279 838 1255 784 C 1227 727 1225 644 1242 587 C 1256 553 1282 530 1320 516 Z",
              "M 1342 898 C 1394 887 1497 888 1564 898 C 1580 925 1582 984 1579 1022 L 1576 1070 C 1532 1087 1383 1087 1336 1069 C 1329 1018 1329 942 1342 898 Z",
            ].map((d,i)=>{const a=current.areas[i];const active=area===a;const recorded=markers.some(m=>m.area===a);return <path key={a} d={d} role="button" tabIndex={0} aria-label={`選擇${a}`} onClick={()=>choose(a)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(a);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.22:recorded?0.14:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="8" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
          </svg> : section==="breast" ? <svg viewBox="0 0 1456 1024" className="block h-auto w-full" aria-label="胸部及腋下症狀點選圖" role="group">
            <image href="/breast-bodymap.png" x="0" y="0" width="1456" height="1024" preserveAspectRatio="xMidYMid meet" />
            {[
              "M 240 415 C 252 447 272 463 306 477 C 339 490 354 510 361 543 C 363 553 362 562 357 570 C 342 541 312 526 281 516 C 245 505 219 509 198 526 C 200 510 200 501 189 497 C 202 461 223 438 240 415 Z",
              "M 198 526 C 225 512 246 508 270 514 C 309 523 341 540 357 568 C 355 583 349 592 340 600 C 320 592 304 593 283 602 C 253 619 224 615 202 601 C 192 581 192 551 198 526 Z",
              "M 202 603 C 223 616 253 618 281 604 C 301 594 321 591 341 600 C 328 622 304 634 280 637 C 246 640 219 627 202 603 Z",
              "M 189 496 C 198 496 203 507 203 523 C 193 547 193 574 202 602 C 192 595 183 585 177 571 C 168 549 168 522 178 505 C 182 498 185 496 189 496 Z",
              "M 510 415 C 497 447 478 463 445 477 C 411 490 396 510 390 543 C 387 554 388 563 392 570 C 409 540 437 526 469 516 C 504 505 531 509 553 526 C 550 509 551 501 562 497 C 549 460 529 438 510 415 Z",
              "M 553 526 C 526 512 505 508 481 514 C 442 523 410 540 392 568 C 395 583 400 592 410 600 C 431 592 446 593 468 602 C 497 619 526 615 549 601 C 559 581 559 551 553 526 Z",
              "M 549 603 C 527 616 497 618 469 604 C 449 594 430 591 410 600 C 422 622 447 634 471 637 C 505 640 533 627 549 603 Z",
              "M 562 496 C 552 496 548 507 548 523 C 558 547 558 574 549 602 C 559 595 568 585 574 571 C 583 549 583 522 572 505 C 568 498 566 496 562 496 Z",
              "M 1306 321 C 1287 315 1272 325 1254 346 C 1230 375 1212 405 1194 435 C 1180 456 1194 495 1205 528 C 1216 562 1232 590 1244 587 C 1264 578 1280 540 C 1297 502 1309 458 1321 415 C 1333 370 1342 338 1329 324 C 1323 319 1314 319 1306 321 Z",
            ].map((d,i)=>{const a=current.areas[i];const active=area===a;const recorded=markers.some(m=>m.area===a);return <path key={a} d={d} role="button" tabIndex={0} aria-label={`選擇${a}`} onClick={()=>choose(a)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(a);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.24:recorded?0.13:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="2" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
          </svg> : section==="body" ? <svg viewBox="0 0 1200 848.4375" className="block h-auto w-full" role="group" aria-label="身體正面與背面可選取部位圖">
            <image href="/body-bodymap.png" x="0" y="0" width="1200" height="848.4375" preserveAspectRatio="xMidYMid meet" />
            {[
              "M 365 191 Q385 206 405 191 L419 210 Q398 223 385 231 Q367 224 347 211 Z",
              "M 315 215 Q336 207 347 211 L369 224 Q341 233 333 267 L305 260 Q299 232 315 215 Z",
              "M 419 210 Q439 207 457 217 Q475 235 472 262 L451 270 Q444 235 405 226 Z",
              "M 337 266 Q359 269 385 282 Q411 269 448 267 L446 311 Q415 301 385 300 Q355 301 334 312 Z",
              "M 305 261 Q319 268 334 265 L332 346 Q314 356 296 349 L296 292 Z",
              "M 451 268 Q466 270 476 263 L479 345 Q462 353 446 346 L447 294 Z",
              "M 296 350 Q315 356 332 346 L318 405 Q307 432 283 431 Q275 424 282 402 Z",
              "M 479 346 Q462 353 446 346 L465 405 Q476 433 496 431 Q503 424 495 402 Z",
              "M 334 315 Q361 305 385 310 Q414 306 446 315 L444 350 Q438 374 453 389 Q421 402 385 401 Q349 401 319 389 Q337 370 334 350 Z",
              "M 319 315 L334 315 L334 351 Q328 372 319 389 L305 389 Q316 353 319 315 Z",
              "M 446 315 L456 316 Q454 350 465 388 L453 389 Q441 372 444 351 Z",
              "M 317 402 Q338 406 352 426 Q370 447 384 463 Q359 475 317 478 Q311 443 317 402 Z",
              "M 453 402 Q433 407 416 426 Q398 447 389 463 Q412 475 459 478 Q466 439 453 402 Z",
              "M 317 479 Q355 472 385 466 L383 570 Q367 576 349 571 Q330 537 317 479 Z",
              "M 389 466 Q424 475 459 479 Q445 540 425 571 Q405 576 390 570 Z",
              "M 349 572 Q367 577 383 572 L383 618 Q366 627 351 617 Z",
              "M 390 572 Q408 577 425 572 L422 618 Q407 627 391 617 Z",
              "M 351 620 Q366 629 383 620 L383 739 Q365 755 351 733 Q339 689 351 620 Z",
              "M 391 620 Q407 628 422 620 Q435 689 420 733 Q404 753 391 739 Z",
              "M 746 192 Q767 208 790 193 L808 211 Q795 223 784 238 Q774 223 758 214 Z",
              "M 712 217 Q731 207 758 214 Q766 229 765 260 Q753 277 735 272 Q727 246 701 259 Q699 233 712 217 Z",
              "M 808 211 Q834 208 857 218 Q874 234 871 261 Q846 246 838 272 Q819 278 803 260 Q801 229 808 211 Z",
              "M 735 273 Q753 281 765 260 L783 238 L784 301 L739 301 Z",
              "M 803 260 Q819 280 838 273 L835 301 L785 301 L784 238 Z",
              "M 701 260 Q717 268 735 273 L727 347 Q711 354 696 347 L691 293 Z",
              "M 838 273 Q855 268 871 260 L878 345 Q861 353 846 347 Z",
              "M 696 348 Q710 356 727 348 L713 408 Q704 433 681 433 Q672 425 679 404 Z",
              "M 846 348 Q861 355 878 347 L898 405 Q904 431 887 432 Q868 431 860 406 Z",
              "M 739 315 L783 315 L783 362 Q760 378 725 370 Q739 347 739 315 Z",
              "M 785 315 L835 315 Q834 348 845 370 Q807 378 785 362 Z",
              "M 725 399 Q753 399 783 427 Q785 462 752 474 Q718 479 709 449 Q708 417 725 399 Z",
              "M 785 427 Q813 399 844 399 Q862 419 858 449 Q849 479 815 474 Q785 462 785 427 Z",
              "M 709 481 Q744 487 782 485 L781 581 Q763 588 741 580 Q721 545 709 481 Z",
              "M 786 485 Q823 487 858 481 Q846 546 827 580 Q807 588 788 581 Z",
              "M 741 582 Q761 590 781 583 L781 620 Q763 628 742 620 Z",
              "M 788 583 Q808 590 827 582 L826 620 Q807 628 788 620 Z",
              "M 742 622 Q761 631 781 622 L781 738 Q761 752 744 737 Q731 686 742 622 Z",
              "M 788 622 Q807 631 826 622 Q837 687 822 737 Q807 752 788 738 Z",
            ].map((d,i)=>{const a=current.areas[i];const active=area===a;const recorded=markers.some(m=>m.area===a);return <path key={a} d={d} role="button" tabIndex={0} aria-label={`選擇${a}`} onClick={()=>choose(a)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(a);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.22:recorded?0.13:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="1.8" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
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
