import { StaffRemoteCreateError } from "./staff-remote-create-errors";

export const STAFF_WRITE_PILOT_OFF_MESSAGE = "遠端員工建立尚未啟用";
export const STAFF_WRITE_UNAUTHORIZED_MESSAGE = "沒有權限新增員工";
export const STAFF_WRITE_CREATE_ONLY_MESSAGE = "員工資料建立後不可由此路徑覆寫";
export const STAFF_SCHEDULE_WRITE_CLOSED_MESSAGE = "遠端班表尚未開放";

export class StaffWritePilotOffError extends StaffRemoteCreateError {
  constructor(message = STAFF_WRITE_PILOT_OFF_MESSAGE) {
    super("pilot_disabled", message);
    this.name = "StaffWritePilotOffError";
  }
}

export class StaffWriteUnauthorizedError extends StaffRemoteCreateError {
  constructor(message = STAFF_WRITE_UNAUTHORIZED_MESSAGE) {
    super("unauthorized", message);
    this.name = "StaffWriteUnauthorizedError";
  }
}

export class StaffWriteConflictError extends StaffRemoteCreateError {
  constructor(message = "員工識別已存在") {
    super("conflict", message);
    this.name = "StaffWriteConflictError";
  }
}

export function refuseStaffWriteMutation(action: string): never {
  throw new StaffRemoteCreateError("privilege_denied", `${STAFF_WRITE_CREATE_ONLY_MESSAGE}: ${action}`);
}
