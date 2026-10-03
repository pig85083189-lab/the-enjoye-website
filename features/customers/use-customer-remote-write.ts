"use client";

import {
  CUSTOMER_REMOTE_WRITE_PILOT_ENV,
  runAuthenticatedCustomerWriteCreate,
  type CustomerRemoteCreateInput,
  type CustomerWriteClient,
} from "@/lib/customers/customer-remote-write-pilot";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "@/lib/customers/customer-remote-read-flag";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function writeClient(): CustomerWriteClient | null {
  return createBrowserClientOrNull() as CustomerWriteClient | null;
}

export async function submitCustomerRemoteCreate(input: CustomerRemoteCreateInput) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  return runAuthenticatedCustomerWriteCreate(client, input, {
    ...process.env,
    [CUSTOMER_REMOTE_WRITE_PILOT_ENV]: "1",
    [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
  });
}
