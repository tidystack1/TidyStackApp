import type { BookingExtraction } from "./extract-booking-from-email";

/** DDMMM with leading zero on day (e.g. 05JUN, 17AUG). */
export function formatDealDate(date: string | null): string | null {
  if (!date) return null;

  const match = /^(\d{1,2})([A-Za-z]{3})$/i.exec(date.trim());
  if (!match) return date.trim().toUpperCase();

  const day = match[1]!.padStart(2, "0");
  return `${day}${match[2]!.toUpperCase()}`;
}

/**
 * Deal name format: First Last DEP ARR DDMMM/DDMMM
 * Example: Kristen Fung LAX KEF 17AUG/02SEP
 */
export function buildDealName(booking: BookingExtraction): string {
  const parts: string[] = [];

  if (booking.passengerName) {
    parts.push(booking.passengerName);
  }

  if (booking.departureAirport) {
    parts.push(booking.departureAirport);
  }

  if (booking.arrivalAirport) {
    parts.push(booking.arrivalAirport);
  }

  const outbound = formatDealDate(booking.outboundDate);
  if (outbound) {
    const returnDate = formatDealDate(booking.returnDate);
    parts.push(returnDate ? `${outbound}/${returnDate}` : outbound);
  }

  return parts.join(" ");
}
