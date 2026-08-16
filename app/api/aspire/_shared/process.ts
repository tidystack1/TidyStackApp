import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  ASPIRE_ACCOUNT_ID,
  ASPIRE_LOCATION_ID,
  CLIENT_INTAKE_FORM_TEMPLATE_ID,
  getLobbieCredentials,
} from "./config";
import { forwardToWebhookSite } from "./forward";
import {
  findIntakeForm,
  isIntakeFormComplete,
  mapIntakeFields,
} from "./intake";
import {
  getFormPacket,
  getFormPacketForms,
  getPatient,
  parsePacketFromUnknown,
} from "./lobbie";
import type {
  JsonObject,
  LobbieFormPacket,
  LobbieWebhookEnvelope,
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

function packetIncludesIntake(packet: LobbieFormPacket): boolean {
  return (packet.formTemplateIds ?? []).includes(CLIENT_INTAKE_FORM_TEMPLATE_ID);
}

export async function processIntakePacket(input: {
  packet: LobbieFormPacket;
  event?: Partial<LobbieWebhookEnvelope>;
  trigger: "webhook" | "manual";
}): Promise<{
  skipped: boolean;
  reason?: string;
  forwarded?: boolean;
  packetId: number;
  formId?: number;
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

  await forwardToWebhookSite({
    source: "aspire-lobbie",
    trigger: input.trigger,
    accountId: ASPIRE_ACCOUNT_ID,
    locationId: ASPIRE_LOCATION_ID,
    formTemplateId: CLIENT_INTAKE_FORM_TEMPLATE_ID,
    event: input.event
      ? {
          eventId: input.event.eventId ?? null,
          eventType: input.event.eventType ?? null,
          occurredAt: input.event.occurredAt ?? null,
          deliveryAttempt: input.event.deliveryAttempt ?? null,
        }
      : null,
    packet: {
      id: packet.id,
      completedAt: packet.completedAt ?? null,
      createdAt: packet.createdAt ?? null,
      updatedAt: packet.updatedAt ?? null,
      patientId: packet.patientId ?? null,
      formTemplateIds: packet.formTemplateIds ?? [],
    },
    intakeForm: {
      id: intakeForm?.id ?? null,
      formTemplateId: intakeForm?.formTemplateId ?? null,
      formTemplateName: intakeForm?.formTemplateName ?? null,
      status: intakeForm?.status ?? null,
      isComplete: intakeForm?.isComplete ?? null,
    },
    patient,
    mapped,
    answers: intakeForm?.answers ?? [],
  });

  return {
    skipped: false,
    forwarded: true,
    packetId: packet.id,
    formId: intakeForm?.id,
  };
}

export async function processWebhookEnvelope(
  envelope: LobbieWebhookEnvelope,
): Promise<{
  skipped: boolean;
  reason?: string;
  forwarded?: boolean;
  packetId?: number;
}> {
  if (envelope.accountId != null && envelope.accountId !== ASPIRE_ACCOUNT_ID) {
    return {
      skipped: true,
      reason: `account ${envelope.accountId} is not Aspire account ${ASPIRE_ACCOUNT_ID}`,
    };
  }

  if (envelope.eventType === "test.ping") {
    await forwardToWebhookSite({
      source: "aspire-lobbie",
      trigger: "webhook",
      eventType: envelope.eventType,
      envelope,
    });
    return { skipped: false, forwarded: true };
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

  return processIntakePacket({
    packet,
    event: envelope,
    trigger: "webhook",
  });
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
