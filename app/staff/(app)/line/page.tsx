import { connection } from "next/server";
import { LineBroadcastCenter } from "@/features/line/LineBroadcastCenter";
import { isLineConnectionPilotEnabled } from "@/lib/line/line-flag";

export default async function LineBroadcastPage() {
  await connection();
  return (
    <LineBroadcastCenter connectionPilotEnabled={isLineConnectionPilotEnabled()} />
  );
}
