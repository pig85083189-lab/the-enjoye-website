/**
 * Calendar New Appointment customer option search.
 * Matches name or phone the same way /staff/customers list search does.
 */

import { normalizePhone } from "@/lib/phone";

export type AppointmentWriteCustomerOption = {
  id: string;
  name: string;
  phone: string;
};

export function filterAppointmentWriteCustomers(
  customers: AppointmentWriteCustomerOption[],
  query: string,
): AppointmentWriteCustomerOption[] {
  const q = query.trim();
  if (!q) return customers;
  const qName = q.toLocaleLowerCase();
  const qPhone = normalizePhone(q);
  return customers.filter((customer) => {
    if (customer.name.toLocaleLowerCase().includes(qName)) return true;
    const phone = normalizePhone(customer.phone);
    return Boolean(qPhone) && phone.includes(qPhone);
  });
}
