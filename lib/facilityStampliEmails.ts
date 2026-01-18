import facilityEmailRowsRaw from "@/data/facility_stampli_emails.json";

type FacilityEmailRow = {
  Facility?: string;
  "Stampli Email Address"?: string;
  "SmartSuite ID"?: string;
};

const facilityEmailRows = facilityEmailRowsRaw as FacilityEmailRow[];

const normalizeFacilityName = (value?: string) =>
  value?.trim().toLowerCase() ?? "";

const facilityEmailMap = new Map<string, string>();
const facilitySmartSuiteIdMap = new Map<string, string>();

facilityEmailRows.forEach((row) => {
  const facilityKey = normalizeFacilityName(row.Facility);
  const email = row["Stampli Email Address"]?.trim();
  const smartSuiteId = row["SmartSuite ID"]?.trim();

  if (facilityKey && email) {
    facilityEmailMap.set(facilityKey, email);
  }
  if (facilityKey && smartSuiteId) {
    facilitySmartSuiteIdMap.set(facilityKey, smartSuiteId);
  }
});

export function getStampliEmailForFacility(
  facility?: string | null
): string | undefined {
  const facilityKey = normalizeFacilityName(facility ?? undefined);
  if (!facilityKey) return undefined;
  return facilityEmailMap.get(facilityKey);
}

export function getSmartSuiteFacilityId(
  facility?: string | null
): string | undefined {
  const facilityKey = normalizeFacilityName(facility ?? undefined);
  if (!facilityKey) return undefined;
  return facilitySmartSuiteIdMap.get(facilityKey);
}
