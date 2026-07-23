/** Outlook plugin category labels that this API handles. Add new entries here. */
export const CATEGORY_HUBSPOT_DEAL = "HubSpot deal";

export const REGISTERED_CATEGORIES = [CATEGORY_HUBSPOT_DEAL] as const;

export function isRegisteredCategory(category: string): boolean {
  return (REGISTERED_CATEGORIES as readonly string[]).includes(category);
}
