import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  ASPIRE_ACCOUNT_ID,
  ASPIRE_LOCATION_ID,
  CLIENT_INTAKE_FORM_TEMPLATE_ID,
  getLobbieCredentials,
} from "./config";
import {
  findIntakeForm,
  isIntakeFormComplete,
  mapIntakeFields,
} from "./intake";
import { upsertClickUpClient } from "./clickup";
import {
  downloadFormFile,
  findIntakePacketForPatient,
  getFormPacket,
  getFormPacketForms,
  getPatient,
  parsePacketFromUnknown,
} from "./lobbie";
import type {
  FileRef,
  JsonObject,
  LobbieFormPacket,
  LobbieWebhookEnvelope,
  MappedIntake,
} from "./types";

export function webhookAccessToken(): string {
  const { clientId, apiKey } = getLobbieCredentials();
  return createHash("sha256")
    .update(`${clientId}:${apiKey}`)
    .digest("hex")
    .slice(0, 32);
}

export function isWebhookTokenValid(token: string | null): boolean {
  return Boolean(token) && token === webhookAccessToken();
}

export function isAspireRequestAuthorized(request: NextRequest): boolean {
  const { apiKey } = getLobbieCredentials();
  const headerKey = request.headers.get("x-api-key");
  if (headerKey && headerKey === apiKey) return true;

  const token =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("x-aspire-webhook-token");
  return isWebhookTokenValid(token);
}

export function aspirePublicOrigin(request: NextRequest): string | null {
  const configured = process.env.ASPIRE_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost || request.headers.get("host");
  if (host && forwardedProto) return `${forwardedProto}://${host}`;
  if (host && !host.includes("localhost") && !host.startsWith("127.")) {
    return `https://${host}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return null;
}

function packetIncludesIntake(packet: LobbieFormPacket): boolean {
  return (packet.formTemplateIds ?? []).includes(CLIENT_INTAKE_FORM_TEMPLATE_ID);
}

export async function processIntakePacket(input: {
  packet: LobbieFormPacket;
}): Promise<{
  skipped: boolean;
  reason?: string;
  packetId: number;
  formId?: number;
  clickup?: { taskId: string; taskUrl: string; created: boolean };
}> {
  const packet =
    packetIncludesIntake(input.packet) && input.packet.patientId
      ? input.packet
      : await getFormPacket(input.packet.id);

  if (packet.locationId && packet.locationId !== ASPIRE_LOCATION_ID) {
    return {
      skipped: true,
      reason: `location ${packet.locationId} is not Aspire location ${ASPIRE_LOCATION_ID}`,
      packetId: packet.id,
    };
  }

  if (!packetIncludesIntake(packet)) {
    return {
      skipped: true,
      reason: `packet does not include Client Intake Form template ${CLIENT_INTAKE_FORM_TEMPLATE_ID}`,
      packetId: packet.id,
    };
  }

  const forms = await getFormPacketForms(packet.id);
  const intakeForm = findIntakeForm(forms, CLIENT_INTAKE_FORM_TEMPLATE_ID);
  if (!isIntakeFormComplete(intakeForm)) {
    return {
      skipped: true,
      reason: "Client Intake Form is not complete yet",
      packetId: packet.id,
      formId: intakeForm?.id,
    };
  }

  const patient = packet.patientId ? await getPatient(packet.patientId) : null;
  const mapped = mapIntakeFields(intakeForm?.answers ?? [], patient);

  if (!packet.patientId) {
    return {
      skipped: true,
      reason: "packet is missing a patient id",
      packetId: packet.id,
      formId: intakeForm?.id,
    };
  }

  const files = await downloadMappedFiles(mapped);
  const clickup = await upsertClickUpClient({
    mapped,
    patientId: packet.patientId,
    files,
  });

  return {
    skipped: false,
    packetId: packet.id,
    formId: intakeForm?.id,
    clickup,
  };
}

export type PatientClickUpFallbacks = {
  clientFirstName?: string;
  clientLastName?: string;
  address?: string;
  insurance?: string;
};

function applyFallbacks(
  mapped: MappedIntake,
  fallbacks?: PatientClickUpFallbacks,
): MappedIntake {
  if (!fallbacks) return mapped;
  return {
    ...mapped,
    clientFirstName: mapped.clientFirstName || fallbacks.clientFirstName || "",
    clientLastName: mapped.clientLastName || fallbacks.clientLastName || "",
    address: mapped.address || fallbacks.address || "",
    insurance: mapped.insurance || fallbacks.insurance || "",
  };
}

export async function processPatientToClickUp(input: {
  patientId: number;
  fallbacks?: PatientClickUpFallbacks;
}): Promise<{
  skipped: boolean;
  reason?: string;
  patientId: number;
  packetId?: number;
  formId?: number;
  clickup?: { taskId: string; taskUrl: string; created: boolean };
}> {
  const patient = await getPatient(input.patientId);
  const packet = await findIntakePacketForPatient(
    input.patientId,
    CLIENT_INTAKE_FORM_TEMPLATE_ID,
  );

  let mapped: MappedIntake = mapIntakeFields([], patient);
  let formId: number | undefined;

  if (packet) {
    const forms = await getFormPacketForms(packet.id);
    const intakeForm = findIntakeForm(forms, CLIENT_INTAKE_FORM_TEMPLATE_ID);
    mapped = mapIntakeFields(intakeForm?.answers ?? [], patient);
    formId = intakeForm?.id;
  }

  mapped = applyFallbacks(mapped, input.fallbacks);
  const files = await downloadMappedFiles(mapped);
  const clickup = await upsertClickUpClient({
    mapped,
    patientId: input.patientId,
    files,
  });

  return {
    skipped: false,
    patientId: input.patientId,
    packetId: packet?.id,
    formId,
    clickup,
  };
}

async function downloadMappedFiles(mapped: {
  diagnosticReport: FileRef | null;
  insuranceCardFront: FileRef | null;
  insuranceCardBack: FileRef | null;
}): Promise<Array<{ file: FileRef; bytes: Uint8Array; filename: string }>> {
  const refs = [
    mapped.diagnosticReport
      ? { file: mapped.diagnosticReport, filename: mapped.diagnosticReport.fileName }
      : null,
    mapped.insuranceCardFront
      ? {
          file: mapped.insuranceCardFront,
          filename: `insurance-card-front.${extensionOf(mapped.insuranceCardFront.fileName)}`,
        }
      : null,
    mapped.insuranceCardBack
      ? {
          file: mapped.insuranceCardBack,
          filename: `insurance-card-back.${extensionOf(mapped.insuranceCardBack.fileName)}`,
        }
      : null,
  ].filter((item): item is { file: FileRef; filename: string } => item != null);

  const downloaded = [];
  for (const item of refs) {
    const bytes = await downloadFormFile(item.file.path);
    if (bytes) downloaded.push({ ...item, bytes });
  }
  return downloaded;
}

function extensionOf(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop() || "bin" : "bin";
}

export async function processWebhookEnvelope(
  envelope: LobbieWebhookEnvelope,
): Promise<{
  skipped: boolean;
  reason?: string;
  packetId?: number;
}> {
  if (envelope.accountId != null && envelope.accountId !== ASPIRE_ACCOUNT_ID) {
    return {
      skipped: true,
      reason: `account ${envelope.accountId} is not Aspire account ${ASPIRE_ACCOUNT_ID}`,
    };
  }

  if (envelope.eventType === "test.ping") {
    return { skipped: true, reason: "test ping" };
  }

  if (
    envelope.eventType &&
    envelope.eventType !== "form-packet.updated" &&
    envelope.eventType !== "form-packet.created"
  ) {
    return {
      skipped: true,
      reason: `ignored event type ${envelope.eventType}`,
    };
  }

  const packet = parsePacketFromUnknown(envelope.data);
  if (!packet) {
    return { skipped: true, reason: "webhook payload did not include a form packet" };
  }

  return processIntakePacket({ packet });
}

export function parseWebhookEnvelope(body: unknown): LobbieWebhookEnvelope | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as JsonObject;
  return {
    version: typeof record.version === "string" ? record.version : undefined,
    eventId: typeof record.eventId === "string" ? record.eventId : undefined,
    eventType: typeof record.eventType === "string" ? record.eventType : undefined,
    accountId:
      typeof record.accountId === "number" ? record.accountId : undefined,
    environment:
      typeof record.environment === "string" ? record.environment : undefined,
    occurredAt:
      typeof record.occurredAt === "string" ? record.occurredAt : undefined,
    sentAt: typeof record.sentAt === "string" ? record.sentAt : undefined,
    deliveryAttempt:
      typeof record.deliveryAttempt === "number"
        ? record.deliveryAttempt
        : undefined,
    data: record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as JsonObject)
      : undefined,
  };
}
