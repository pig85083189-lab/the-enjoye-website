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
  { id: "breast", label: "胸部", symbol: "♡", areas: ["右胸上緣", "右胸中央", "右胸下緣", "右胸外側", "左胸上緣", "左胸中央", "左胸下緣", "左胸外側"] },
  { id: "axilla", label: "腋下", symbol: "✧", areas: ["右腋下", "左腋下", "腋下"] },
  { id: "right-arm", label: "右手臂", symbol: "⌁", areas: ["正面右上臂","正面右前臂","背面右上臂","背面右前臂"] },
  { id: "left-arm", label: "左手臂", symbol: "⌁", areas: ["正面左上臂","正面左前臂","背面左上臂","背面左前臂"] },
  { id: "body", label: "身體", symbol: "♧", areas: ["正面肩頸","正面右肩","正面左肩","正面胸口","腹部","右腰","左腰","背面肩頸","背面右肩","背面左肩","右上背","左上背","右下背","左下背"] },
  { id: "legs", label: "大小腿", symbol: "♧", areas: ["正面右大腿","正面左大腿","正面右膝","正面左膝","正面右小腿","正面左小腿","背面右大腿","背面左大腿","背面右膝","背面左膝","背面右小腿","背面左小腿"] },
  { id: "womb", label: "子宮", symbol: "◇", areas: ["下腹中央", "左下腹", "右下腹", "骨盆區", "腰骶部"] },
] as const;
const breastImageAreas = ["右胸上緣","右胸中央","右胸下緣","右胸外側","左胸上緣","左胸中央","左胸下緣","左胸外側","腋下"];
const bodyImageAreas = ["正面肩頸","正面右肩","正面左肩","正面胸口","正面右上臂","正面左上臂","正面右前臂","正面左前臂","腹部","右腰","左腰","正面右臀髖","正面左臀髖","正面右大腿","正面左大腿","正面右膝","正面左膝","正面右小腿","正面左小腿","背面肩頸","背面右肩","背面左肩","右上背","左上背","背面右上臂","背面左上臂","背面右前臂","背面左前臂","右下背","左下背","右臀","左臀","背面右大腿","背面左大腿","背面右膝","背面左膝","背面右小腿","背面左小腿"];
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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-8">{sections.map(s=><button key={s.id} type="button" onClick={()=>{setSection(s.id);setArea(null);}} aria-pressed={section===s.id} className={`min-h-20 rounded-xl border px-1 py-2 text-center text-sm font-medium transition-colors ${section===s.id?"border-[#B87981] bg-[#B87981] text-white":"border-[#F0DFDF] bg-[#FBF5F5] text-[#85555F]"}`}><span className="mb-1 block text-xl" aria-hidden="true">{s.symbol}</span>{s.label}</button>)}</div>
    </Card>
    <Card padding="md" className="mb-4">
      <h2 className="text-base font-semibold text-text">{current.label}症狀標記</h2>
      <p className="mt-1 text-sm text-secondary-text">點選圖片中的症狀區域，再選擇症狀（可複選）。左右以顧客本人方向為準。</p>
      <div className={`mt-4 grid gap-4 ${section==="head"||section==="breast"||section==="axilla"||section==="legs"?"xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]":"lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        <div className={`relative mx-auto w-full ${section==="head"||section==="breast"||section==="axilla"||section==="body"||section==="right-arm"||section==="left-arm"||section==="legs"?"max-w-[800px]":"max-w-[310px]"}`}>
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
              "M 286 519 C 317 456 374 374 416 339 C 431 400 481 444 557 476 C 632 509 680 564 693 675 C 651 626 598 578 535 565 C 459 546 393 558 330 592 C 339 548 317 522 286 519 Z",
              "M 329 594 C 387 555 455 548 524 565 C 598 583 657 622 689 676 C 682 730 651 759 615 774 C 566 751 528 749 486 771 C 431 798 369 790 328 767 C 312 721 309 647 329 594 Z",
              "M 328 767 C 386 796 435 803 488 777 C 535 752 569 752 615 774 C 568 821 516 844 463 844 C 406 842 359 819 328 767 Z",
              "M 285 520 C 324 524 338 551 328 593 C 310 654 312 718 328 768 C 287 750 265 712 259 662 C 253 610 263 550 285 520 Z",
              "M 1028 339 C 1070 376 1124 455 1158 519 C 1126 522 1105 548 1118 592 C 1054 558 988 546 912 565 C 850 579 795 626 752 675 C 765 565 815 510 888 476 C 964 443 1015 400 1028 339 Z",
              "M 790 774 C 754 759 724 729 748 676 C 780 622 839 583 912 565 C 981 548 1050 555 1118 594 C 1137 646 1135 720 1118 767 C 1076 790 1016 798 960 771 C 919 749 879 751 790 774 Z",
              "M 790 774 C 836 752 874 752 919 777 C 972 803 1024 796 1118 767 C 1087 819 1040 842 983 844 C 930 844 837 821 790 774 Z",
              "M 1158 520 C 1180 550 1190 610 1184 662 C 1178 712 1156 750 1118 768 C 1133 718 1135 654 1118 593 C 1108 551 1122 524 1158 520 Z",
            ].map((d,i)=>{const a=breastImageAreas[i];if(!current.areas.some(x=>x===a))return null;const active=area===a;const recorded=markers.some(m=>m.area===a);return <path key={a} d={d} role="button" tabIndex={0} aria-label={`選擇${a}`} onClick={()=>choose(a)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(a);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.24:recorded?0.13:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="2" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
          </svg> : section==="axilla" ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" aria-label="左右腋下症狀點選圖" role="group">
            <image href="/axilla-bodymap.png" x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            {[
              { name: "右腋下", d: "M 705 677 C 741 716 783 765 811 819 C 797 867 772 911 738 958 C 712 918 684 866 671 816 C 670 774 686 716 705 677 Z" },
              { name: "左腋下", d: "M 1342 677 C 1307 716 1265 765 1236 819 C 1250 867 1275 911 1309 958 C 1335 918 1363 866 1376 816 C 1377 774 1361 716 1342 677 Z" },
            ].map(({name,d})=>{const active=area===name;const recorded=markers.some(m=>m.area===name);return <path key={name} d={d} role="button" tabIndex={0} aria-label={`選擇${name}`} onClick={()=>choose(name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(name);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.24:recorded?0.13:0} stroke={active?"#A35B6A":recorded?"#C97786":"transparent"} strokeWidth="5" className="cursor-pointer outline-none focus:stroke-[#A35B6A]" />;})}
          </svg> : (section==="right-arm"||section==="left-arm") ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" role="group" aria-label={section==="left-arm"?"左手臂正面與背面選取圖":"右手臂正面與背面選取圖"}>
            <image href={section==="left-arm"?"/left-arm-bodymap.png":"/right-arm-bodymap.png"} x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            {(section==="left-arm" ? [
              {name:"正面左上臂",d:"M 1865 113 L 1772 79 L 1620 108 L 1473 203 L 1328 268 L 1192 359 L 1080 393 L 1080 642 L 1257 555 L 1544 472 L 1822 239 L 1853 187 Z"},
              {name:"正面左前臂",d:"M 1079 393 L 916 440 L 623 596 L 453 652 L 400 652 L 400 883 L 543 773 L 949 685 L 1079 642 Z"},
              {name:"背面左上臂",d:"M 2017 655 L 1919 616 L 1783 638 L 1692 679 L 1574 769 L 1456 811 L 1307 887 L 1200 907 L 1200 1122 L 1380 1053 L 1641 994 L 1959 767 L 1997 719 Z"},
              {name:"背面左前臂",d:"M 1199 907 L 1059 930 L 825 1039 L 557 1111 L 430 1114 L 430 1356 L 533 1312 L 612 1243 L 655 1225 L 1022 1168 L 1199 1122 Z"}
            ] : [
              {name:"正面右上臂",d:"M 82 315 L 106 382 L 156 435 L 469 601 L 767 624 L 909 665 L 909 429 L 798 421 L 625 353 L 491 326 L 389 278 L 314 260 L 172 262 Z"},
              {name:"正面右前臂",d:"M 910 429 L 912 666 L 1083 688 L 1500 690 L 1659 766 L 1659 540 L 1580 555 L 1392 534 L 1096 446 Z"},
              {name:"背面右上臂",d:"M 32 950 L 64 1005 L 119 1048 L 476 1192 L 736 1189 L 889 1213 L 889 1005 L 776 1011 L 632 975 L 488 958 L 357 899 L 252 879 L 126 887 Z"},
              {name:"背面右前臂",d:"M 890 1005 L 893 1214 L 1125 1218 L 1497 1189 L 1639 1248 L 1639 1035 L 1558 1055 L 1357 1054 L 1025 995 Z"}
            ]).map(({name,d})=>{const active=area===name;const recorded=markers.some(m=>m.area===name);return <path key={name} d={d} role="button" tabIndex={0} aria-label={`選擇${name}`} onClick={()=>choose(name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(name);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.36:recorded?0.18:0} stroke={active?"#813D52":recorded?"#C97786":"transparent"} strokeWidth={active?9:recorded?6:5} strokeLinejoin="round" className="cursor-pointer transition-colors duration-150 hover:fill-[#B87981] hover:fill-opacity-30 hover:stroke-[#A35B6A] focus:fill-[#B87981] focus:fill-opacity-30 focus:stroke-[#A35B6A] outline-none" />;})}
          </svg> : section==="body" ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" role="group" aria-label="上半身正面與背面症狀點選圖">
            <image href="/body-upper-bodymap.png" x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            <g transform="scale(2)">
            {[
              {name:"正面肩頸",d:"M 207 134 L 313 134 Q 325 150 352 160 L 353 178 Q 304 166 267 181 Q 213 168 168 180 L 168 161 Q 195 151 207 134 Z"},
              {name:"正面右肩",d:"M 167 161 Q 118 159 90 180 Q 57 207 60 260 L 67 317 Q 82 282 109 256 Q 127 230 157 220 L 167 178 Z"},
              {name:"正面左肩",d:"M 353 161 Q 402 157 431 181 Q 457 209 457 263 L 449 316 Q 433 277 410 254 Q 393 228 362 220 L 353 178 Z"},
              {name:"正面胸口",d:"M 168 179 Q 204 177 222 187 Q 265 204 309 187 Q 327 177 353 179 L 361 224 Q 385 261 384 291 L 363 377 Q 267 400 157 376 L 137 290 Q 137 263 160 225 Z"},
              {name:"腹部",d:"M 157 407 Q 262 415 364 408 Q 349 462 357 486 Q 365 517 390 550 Q 266 588 131 550 Q 156 518 164 482 Q 173 458 157 407 Z"},
              {name:"右腰",d:"M 155 410 L 180 413 Q 175 447 170 476 Q 168 516 131 550 L 112 562 Q 152 509 162 472 Z"},
              {name:"左腰",d:"M 343 413 L 365 409 Q 356 459 361 480 Q 370 514 391 550 L 410 563 Q 372 523 356 478 Z"},
              {name:"背面肩頸",d:"M 725 134 L 822 134 Q 842 150 865 158 L 866 179 Q 815 165 773 194 Q 730 165 686 179 L 686 159 Q 711 150 725 134 Z"},
              {name:"背面右肩",d:"M 686 159 Q 631 159 602 188 Q 573 220 577 273 L 585 323 Q 605 275 627 258 Q 650 228 688 218 L 698 183 Z"},
              {name:"背面左肩",d:"M 866 159 Q 917 159 946 186 Q 975 220 971 271 L 963 322 Q 942 275 922 256 Q 901 228 862 218 L 853 183 Z"},
              {name:"右上背",d:"M 698 183 Q 735 176 774 194 L 774 343 Q 747 353 715 332 Q 687 310 672 276 L 690 218 Z"},
              {name:"左上背",d:"M 774 194 Q 814 176 852 183 L 860 218 L 878 276 Q 860 314 835 332 Q 805 353 774 343 Z"},
              {name:"右下背",d:"M 670 418 L 774 421 L 774 556 Q 710 563 647 550 Q 666 517 675 479 Q 680 446 670 418 Z"},
              {name:"左下背",d:"M 774 421 L 878 418 Q 869 448 879 483 Q 890 520 907 550 Q 843 564 774 556 Z"},
            ].map(({name,d})=>{const active=area===name;const recorded=markers.some(m=>m.area===name);return <path key={name} d={d} role="button" tabIndex={0} aria-label={`選擇${name}`} onClick={()=>choose(name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(name);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.34:recorded?0.15:0} stroke={active?"#74364B":recorded?"#B96D80":"transparent"} strokeWidth={active?5:recorded?3:2.5} strokeLinejoin="round" className="cursor-pointer transition-colors duration-150 hover:fill-[#B87981] hover:fill-opacity-40 hover:stroke-[#813D52] focus:fill-[#B87981] focus:fill-opacity-40 focus:stroke-[#813D52] outline-none" />;})}
            </g>
          </svg> : section==="legs" ? <svg viewBox="0 0 2048 1448" className="block h-auto w-full" role="group" aria-label="大小腿背面與正面可選取部位圖">
            <image href="/legs-bodymap.png" x="0" y="0" width="2048" height="1448" preserveAspectRatio="xMidYMid meet" />
            {[
              {name:"背面右大腿",d:"M 382 0 L 581 0 Q 600 48 593 117 Q 586 204 571 298 Q 555 404 537 510 Q 527 553 516 573 Q 483 558 447 572 Q 426 541 417 493 Q 398 402 376 310 Q 352 212 345 140 Q 337 56 382 0 Z"},
              {name:"背面左大腿",d:"M 610 0 L 806 0 Q 851 57 846 139 Q 838 218 813 314 Q 792 406 775 492 Q 765 544 747 573 Q 713 558 676 573 Q 663 549 654 507 Q 634 399 620 302 Q 606 207 599 117 Q 590 50 610 0 Z"},
              {name:"背面右膝",d:"M 447 572 Q 478 553 516 573 Q 537 600 538 635 Q 529 671 492 699 Q 451 679 434 637 Q 433 600 447 572 Z"},
              {name:"背面左膝",d:"M 676 573 Q 713 553 747 573 Q 766 604 767 637 Q 749 678 710 699 Q 675 674 659 634 Q 658 599 676 573 Z"},
              {name:"背面右小腿",d:"M 434 637 Q 453 678 492 699 Q 529 670 538 635 Q 561 683 571 752 Q 583 817 568 889 Q 551 973 543 1037 Q 537 1112 543 1194 L 552 1263 Q 526 1295 496 1306 Q 476 1252 468 1179 Q 458 1091 438 1003 Q 416 913 407 826 Q 399 720 434 637 Z"},
              {name:"背面左小腿",d:"M 659 634 Q 676 676 710 699 Q 748 673 767 637 Q 801 723 793 825 Q 783 917 761 1004 Q 743 1092 733 1180 Q 724 1252 706 1306 Q 674 1295 649 1263 L 657 1194 Q 663 1111 656 1037 Q 646 972 633 889 Q 616 817 630 752 Q 639 683 659 634 Z"},
              {name:"正面右大腿",d:"M 1537 0 L 1753 0 Q 1774 70 1765 157 Q 1756 252 1740 342 Q 1725 431 1704 514 Q 1697 551 1683 579 Q 1641 561 1600 579 Q 1583 545 1572 510 Q 1553 429 1540 340 Q 1524 246 1520 157 Q 1511 69 1537 0 Z"},
              {name:"正面左大腿",d:"M 1288 0 L 1504 0 Q 1529 69 1520 157 Q 1516 247 1500 340 Q 1487 430 1468 510 Q 1457 545 1440 579 Q 1399 561 1357 579 Q 1343 551 1336 514 Q 1315 430 1300 342 Q 1284 252 1275 157 Q 1266 69 1288 0 Z"},
              {name:"正面右膝",d:"M 1600 579 Q 1641 560 1683 579 Q 1699 608 1693 646 Q 1677 688 1642 703 Q 1608 687 1588 647 Q 1585 611 1600 579 Z"},
              {name:"正面左膝",d:"M 1357 579 Q 1399 560 1440 579 Q 1455 611 1452 647 Q 1432 687 1398 703 Q 1363 688 1347 646 Q 1341 608 1357 579 Z"},
              {name:"正面右小腿",d:"M 1588 647 Q 1608 687 1642 703 Q 1677 688 1693 646 Q 1720 718 1721 803 Q 1719 885 1703 971 Q 1691 1050 1684 1120 Q 1675 1206 1695 1291 L 1706 1322 Q 1664 1341 1621 1326 Q 1603 1250 1606 1167 Q 1608 1094 1593 1014 Q 1572 918 1559 833 Q 1544 738 1588 647 Z"},
              {name:"正面左小腿",d:"M 1347 646 Q 1363 688 1398 703 Q 1432 687 1452 647 Q 1496 738 1481 833 Q 1468 918 1447 1014 Q 1432 1094 1434 1167 Q 1437 1250 1419 1326 Q 1376 1341 1334 1322 L 1345 1291 Q 1365 1206 1356 1120 Q 1349 1050 1337 971 Q 1321 885 1319 803 Q 1318 718 1347 646 Z"},
            ].map(({name,d})=>{const active=area===name;const recorded=markers.some(m=>m.area===name);return <path key={name} d={d} role="button" tabIndex={0} aria-label={`選擇${name}`} onClick={()=>choose(name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(name);}}} fill={active?"#B87981":recorded?"#C97786":"transparent"} fillOpacity={active?0.30:recorded?0.14:0} stroke={active?"#74364B":recorded?"#C97786":"transparent"} strokeWidth={active?7:recorded?4:3} strokeLinejoin="round" className="cursor-pointer transition-colors duration-150 hover:fill-[#B87981] hover:fill-opacity-32 hover:stroke-[#813D52] focus:stroke-[#A35B6A] outline-none" />;})}
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
