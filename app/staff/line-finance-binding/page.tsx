import {redirect} from "next/navigation";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import StaffFinanceLineBinding from "./StaffFinanceLineBinding";
export const dynamic="force-dynamic";
export default async function LineFinanceBindingPage(){
 const identity=await getAuthenticatedStaffMembership({organizationId:"org-the-enjoye"});
 if(identity.status!=="ok"||!identity.membership.isActive||
    !["OWNER","MANAGER"].includes(identity.membership.role))redirect("/staff");
 return <StaffFinanceLineBinding/>;
}
