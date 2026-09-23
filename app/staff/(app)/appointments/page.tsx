import { redirect } from "next/navigation";
import { CANONICAL_CALENDAR_HREF } from "@/lib/navigation/config";

/** Legacy route — canonical schedule UI lives at /staff/calendar */
export default function AppointmentsRedirectPage() {
  redirect(CANONICAL_CALENDAR_HREF);
}
