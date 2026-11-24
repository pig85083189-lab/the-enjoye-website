import {NextResponse} from "next/server";
import {grantSettledBookingSpend} from "@/lib/lucky-draw/booking-spend-server";

export const dynamic="force-dynamic";
export async function POST(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({code:"INVALID_ORIGIN"},{status:403,headers});
 if(!request.headers.get("content-type")?.startsWith("application/json"))return NextResponse.json({code:"INVALID_CONTENT_TYPE"},{status:415,headers});
 let body:unknown;
 try{body=await request.json();}catch{return NextResponse.json({code:"INVALID_INPUT"},{status:400,headers});}
 const draftId=body&&typeof body==="object"&&"draftId" in body?body.draftId:null;
 if(typeof draftId!=="string"||!draftId.trim()||draftId.length>200)return NextResponse.json({code:"INVALID_INPUT"},{status:400,headers});
 // Helper re-reads the authenticated, completed transaction and verifies staff
 // and LINE identity. No client-provided amount, member ID or reward count.
 await grantSettledBookingSpend(draftId.trim());
 return NextResponse.json({accepted:true},{status:202,headers});
}
