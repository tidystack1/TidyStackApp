import {
  ASPIRE_EMAIL_SENDERS,
  ASPIRE_NO_TECH_CC,
  CLICKUP_ASSESSMENT_STAGE,
  CLICKUP_FIELDS,
  CLICKUP_NO_TECH_STATUS,
  EMAIL_AUTOMATIONS,
  getAspireN8nWebhookUrl,
  type EmailAutomationId,
} from "./config";
import {
  getClickUpTask,
  type ClickUpTask,
  type ClickUpTaskCustomField,
} from "./clickup";
import type { JsonObject } from "./types";
import {
  collectDueEmailAutomations,
  ensureAutomationFieldIds,
  markAutomationSent,
  readScheduleState,
  stampNoTechStart,
  stampWaitingListStart,
} from "./email-schedule";

export { EMAIL_AUTOMATIONS, type EmailAutomationId };

type FollowUp = {
  automation: EmailAutomationId;
  waitDays: number;
  waitDaysFromPrevious: number;
};

type EmailContent = {
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  bodyHtml: string;
};

export type N8nEmailPayload = {
  source: "aspire";
  action: "send_email" | "schedule_only";
  automation: EmailAutomationId;
  taskId: string;
  taskUrl: string;
  trigger: "clickup_webhook" | "daily_scan";
  startedAt: string | null;
  daysElapsed: number | null;
  email: EmailContent | null;
  fields: ClientEmailFields;
  followUps: FollowUp[];
  callback: { url: string; method: "POST" } | null;
};

export type AutomationRunResult = {
  automation: EmailAutomationId;
  taskId: string;
  skipped: boolean;
  reason?: string;
  n8nStatus?: number;
};

type ClientEmailFields = {
  clientFirstName: string;
  clientLastName: string;
  guardian1FirstName: string;
  guardian1LastName: string;
  guardian1Email: string;
  assignedBcbaName: string;
  assessmentStage: string;
  status: string;
};

type ClickUpHistoryItem = {
  id?: string;
  field?: string;
  date?: string | number;
  before?: unknown;
  after?: unknown;
  custom_field?: { id?: string; name?: string; type?: string };
};

const WAITING_LIST_FOLLOWUPS: FollowUp[] = [
  {
    automation: EMAIL_AUTOMATIONS.waitingListDay10,
    waitDays: 10,
    waitDaysFromPrevious: 10,
  },
  {
    automation: EMAIL_AUTOMATIONS.waitingListDay20,
    waitDays: 20,
    waitDaysFromPrevious: 10,
  },
  {
    automation: EMAIL_AUTOMATIONS.waitingListDay30,
    waitDays: 30,
    waitDaysFromPrevious: 10,
  },
];

const NO_TECH_FOLLOWUPS: FollowUp[] = [
  {
    automation: EMAIL_AUTOMATIONS.noTechDay15,
    waitDays: 15,
    waitDaysFromPrevious: 15,
  },
  {
    automation: EMAIL_AUTOMATIONS.noTechDay20,
    waitDays: 20,
    waitDaysFromPrevious: 5,
  },
  {
    automation: EMAIL_AUTOMATIONS.noTechDay25,
    waitDays: 25,
    waitDaysFromPrevious: 5,
  },
];

function fieldById(
  task: ClickUpTask,
  fieldId: string,
): ClickUpTaskCustomField | undefined {
  return task.custom_fields?.find((field) => field.id === fieldId);
}

function textField(task: ClickUpTask, fieldId: string): string {
  const value = fieldById(task, fieldId)?.value;
  return typeof value === "string" ? value.trim() : "";
}

function dropdownName(field: ClickUpTaskCustomField | undefined): string {
  if (!field) return "";
  const options = field.type_config?.options ?? [];
  const value = field.value;
  if (value == null || value === "") return "";

  if (typeof value === "number") {
    return (
      options.find((option) => option.orderindex === value)?.name ||
      options[value]?.name ||
      ""
    );
  }

  if (typeof value === "string") {
    const match = options.find(
      (option) =>
        option.id === value ||
        option.name.toLowerCase() === value.toLowerCase(),
    );
    return match?.name || value;
  }

  if (typeof value === "object") {
    const record = value as JsonObject;
    if (typeof record.id === "string") {
      return options.find((option) => option.id === record.id)?.name || "";
    }
    if (typeof record.name === "string") return record.name;
  }

  return "";
}

function relatedTaskIds(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) {
    if (typeof value === "object") {
      const record = value as JsonObject;
      if (typeof record.id === "string" && record.id.trim()) return [record.id];
      if (Array.isArray(record.add)) return relatedTaskIds(record.add);
    }
    return [];
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) ids.push(item.trim());
    else if (item && typeof item === "object" && "id" in item) {
      const id = String((item as { id: unknown }).id || "").trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

function relatedTaskNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object" && "name" in item) {
        return String((item as { name?: unknown }).name || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

async function assignedBcbaName(task: ClickUpTask): Promise<string> {
  const field = fieldById(task, CLICKUP_FIELDS.assignedBcba);
  const names = relatedTaskNames(field?.value);
  if (names.length > 0) return names.join(", ");

  const ids = relatedTaskIds(field?.value);
  if (ids.length === 0) return "";

  const fetched: string[] = [];
  for (const id of ids) {
    const related = await getClickUpTask(id);
    const name = related.name.trim();
    if (name) fetched.push(name);
  }
  return fetched.join(", ");
}

function statusName(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "status" in value) {
    return String((value as { status?: unknown }).status || "").trim();
  }
  return "";
}

function matchesAssessmentOption(
  value: unknown,
  option: { id: string; name: string; orderindex: number },
): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "number") return value === option.orderindex;
  if (typeof value === "string") {
    return (
      value === option.id || value.toLowerCase() === option.name.toLowerCase()
    );
  }
  if (typeof value === "object") {
    const record = value as JsonObject;
    if (typeof record.id === "string") return record.id === option.id;
    if (typeof record.name === "string") {
      return record.name.toLowerCase() === option.name.toLowerCase();
    }
  }
  return false;
}

function changedTo(
  before: unknown,
  after: unknown,
  matches: (value: unknown) => boolean,
): boolean {
  return matches(after) && !matches(before);
}

function fullName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(body: string): string {
  return body
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function waitingListCopy(fields: ClientEmailFields): { subject: string; body: string } {
  const guardian = fullName(fields.guardian1FirstName, fields.guardian1LastName);
  const client = fields.clientFirstName || "your child";
  return {
    subject: `Update on ${client} ABA Services`,
    body: `Hi ${guardian || "there"},

This is Rikki from Aspire ABA Therapy. I hope you are doing well!

We are excited to provide you with an update regarding ${client} ABA services! ${client} remains on our BCBA waiting list, and our team is actively working to identify an amazing BCBA who will be a great fit for ${client} and your family.

We understand how important it is to get services started, and we truly appreciate your patience as we work toward the next step. We will continue to keep you updated as we have more information.

Please do not hesitate to reach out with any questions.

Thank you for choosing Aspire ABA Therapy!

All the best,
Rikki Roth`,
  };
}

function bcbaAssignedCopy(fields: ClientEmailFields): { subject: string; body: string } {
  const guardian = fullName(fields.guardian1FirstName, fields.guardian1LastName);
  const client = fields.clientFirstName || "your child";
  const bcba = fields.assignedBcbaName || "your assigned BCBA";
  return {
    subject: `An Exciting Update in ${client} ABA Journey`,
    body: `Hi ${guardian || "there"},

This is Rikki at Aspire ABA Therapy. I hope you are doing well!

We are excited to share that a BCBA has been assigned to ${client} case!

We are looking forward to beginning this next step and connecting you with ${client} BCBA. Please see their information below.

Name: ${bcba}

They will be working closely with your family to support ${client} individual needs. We truly appreciate your trust in Aspire ABA Therapy and look forward to getting started!

Welcome to Aspire ABA Therapy!

Warmly,
Aspire ABA Therapy Team`,
  };
}

function noTechDay15Copy(fields: ClientEmailFields): { subject: string; body: string } {
  const guardian = fullName(fields.guardian1FirstName, fields.guardian1LastName);
  const clientFirst = fields.clientFirstName || "your child";
  const clientFull =
    fullName(fields.clientFirstName, fields.clientLastName) || clientFirst;
  return {
    subject: `Staffing Update for ${clientFull}`,
    body: `Hi ${guardian || "there"},

I wanted to provide you with a quick update regarding staffing for ${clientFirst}.

The ITP has been completed, and we are actively searching for an RBT who will be a good fit for ${clientFirst} and your family.

At this time, we have not yet found a technician who is able to take on the case, but we are continuing our search based on the recommended schedule and needs of the case.

We will continue to keep you updated as we make progress.

Thank you,
Recruiting Team`,
  };
}

function noTechDay20Copy(fields: ClientEmailFields): { subject: string; body: string } {
  const guardian = fullName(fields.guardian1FirstName, fields.guardian1LastName);
  const clientFirst = fields.clientFirstName || "your child";
  const clientFull =
    fullName(fields.clientFirstName, fields.clientLastName) || clientFirst;
  return {
    subject: `Staffing Update for ${clientFull}`,
    body: `Hi ${guardian || "there"},

I just wanted to touch base with a quick update regarding staffing for ${clientFirst}.

We are still working to identify an available technician for the case. Our team is continuing to reach out to potential candidates and review availability.

We will reach out as soon as we have an update to share.

Thank you,
Recruiting Team`,
  };
}

function noTechDay25Copy(fields: ClientEmailFields): { subject: string; body: string } {
  const guardian = fullName(fields.guardian1FirstName, fields.guardian1LastName);
  const clientFirst = fields.clientFirstName || "your child";
  const clientFull =
    fullName(fields.clientFirstName, fields.clientLastName) || clientFirst;
  return {
    subject: `Staffing Update for ${clientFull}`,
    body: `Hi ${guardian || "there"},

I wanted to provide another update regarding staffing for ${clientFirst}.

At this time, we are still working to secure technician coverage for the case. We are continuing to look for an available RBT who can accommodate the recommended schedule.

We will be in touch as soon as there is an update.

Thank you,
Recruiting Team`,
  };
}

function emailFromCopy(
  copy: { subject: string; body: string },
  input: {
    fromName: string;
    fromEmail: string;
    to: string;
    cc?: string[];
  },
): EmailContent {
  return {
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    to: input.to,
    cc: input.cc ?? [],
    subject: copy.subject,
    body: copy.body,
    bodyHtml: toHtml(copy.body),
  };
}

async function loadClientFields(taskId: string): Promise<{
  task: ClickUpTask;
  fields: ClientEmailFields;
}> {
  const task = await getClickUpTask(taskId);
  const fields: ClientEmailFields = {
    clientFirstName: textField(task, CLICKUP_FIELDS.clientFirstName),
    clientLastName: textField(task, CLICKUP_FIELDS.clientLastName),
    guardian1FirstName: textField(task, CLICKUP_FIELDS.guardian1FirstName),
    guardian1LastName: textField(task, CLICKUP_FIELDS.guardian1LastName),
    guardian1Email: textField(task, CLICKUP_FIELDS.guardian1Email),
    assignedBcbaName: await assignedBcbaName(task),
    assessmentStage: dropdownName(fieldById(task, CLICKUP_FIELDS.assessmentStage)),
    status: statusName(task.status),
  };
  return { task, fields };
}

function taskUrlOf(task: ClickUpTask): string {
  return task.url || `https://app.clickup.com/t/${task.id}`;
}

function buildEmail(
  automation: EmailAutomationId,
  fields: ClientEmailFields,
): EmailContent | { error: string } {
  if (!fields.guardian1Email.includes("@")) {
    return { error: "Guardian 1 email is missing" };
  }

  if (
    automation === EMAIL_AUTOMATIONS.waitingListDay0 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay10 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay20 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay30
  ) {
    return emailFromCopy(waitingListCopy(fields), {
      ...ASPIRE_EMAIL_SENDERS.rikki,
      fromName: ASPIRE_EMAIL_SENDERS.rikki.name,
      fromEmail: ASPIRE_EMAIL_SENDERS.rikki.email,
      to: fields.guardian1Email,
    });
  }

  if (automation === EMAIL_AUTOMATIONS.bcbaAssigned) {
    return emailFromCopy(bcbaAssignedCopy(fields), {
      fromName: ASPIRE_EMAIL_SENDERS.rikki.name,
      fromEmail: ASPIRE_EMAIL_SENDERS.rikki.email,
      to: fields.guardian1Email,
    });
  }

  if (automation === EMAIL_AUTOMATIONS.noTechDay15) {
    return emailFromCopy(noTechDay15Copy(fields), {
      fromName: ASPIRE_EMAIL_SENDERS.recruiting.name,
      fromEmail: ASPIRE_EMAIL_SENDERS.recruiting.email,
      to: fields.guardian1Email,
      cc: [...ASPIRE_NO_TECH_CC],
    });
  }

  if (automation === EMAIL_AUTOMATIONS.noTechDay20) {
    return emailFromCopy(noTechDay20Copy(fields), {
      fromName: ASPIRE_EMAIL_SENDERS.recruiting.name,
      fromEmail: ASPIRE_EMAIL_SENDERS.recruiting.email,
      to: fields.guardian1Email,
      cc: [...ASPIRE_NO_TECH_CC],
    });
  }

  if (automation === EMAIL_AUTOMATIONS.noTechDay25) {
    return emailFromCopy(noTechDay25Copy(fields), {
      fromName: ASPIRE_EMAIL_SENDERS.recruiting.name,
      fromEmail: ASPIRE_EMAIL_SENDERS.recruiting.email,
      to: fields.guardian1Email,
      cc: [...ASPIRE_NO_TECH_CC],
    });
  }

  return { error: `Unknown automation ${automation}` };
}

function stillWaitingList(fields: ClientEmailFields): boolean {
  return (
    fields.assessmentStage.toLowerCase() ===
    CLICKUP_ASSESSMENT_STAGE.waitingList.name.toLowerCase()
  );
}

function stillNoTech(fields: ClientEmailFields): boolean {
  return fields.status.toLowerCase() === CLICKUP_NO_TECH_STATUS;
}

function conditionFor(automation: EmailAutomationId): {
  check: (fields: ClientEmailFields) => boolean;
  reason: string;
} | null {
  if (
    automation === EMAIL_AUTOMATIONS.waitingListDay0 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay10 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay20 ||
    automation === EMAIL_AUTOMATIONS.waitingListDay30
  ) {
    return {
      check: stillWaitingList,
      reason: `Assessment stage is "${CLICKUP_ASSESSMENT_STAGE.waitingList.name}"`,
    };
  }
  if (automation === EMAIL_AUTOMATIONS.bcbaAssigned) {
    return {
      check: (fields) =>
        fields.assessmentStage.toLowerCase() ===
        CLICKUP_ASSESSMENT_STAGE.assignedBcba.name.toLowerCase(),
      reason: `Assessment stage is "${CLICKUP_ASSESSMENT_STAGE.assignedBcba.name}"`,
    };
  }
  if (
    automation === EMAIL_AUTOMATIONS.noTechAssigned ||
    automation === EMAIL_AUTOMATIONS.noTechDay15 ||
    automation === EMAIL_AUTOMATIONS.noTechDay20 ||
    automation === EMAIL_AUTOMATIONS.noTechDay25
  ) {
    return {
      check: stillNoTech,
      reason: `Status is "${CLICKUP_NO_TECH_STATUS}"`,
    };
  }
  return null;
}

function followUpsFor(automation: EmailAutomationId): FollowUp[] {
  if (automation === EMAIL_AUTOMATIONS.waitingListDay0) {
    return WAITING_LIST_FOLLOWUPS;
  }
  if (automation === EMAIL_AUTOMATIONS.noTechAssigned) {
    return NO_TECH_FOLLOWUPS;
  }
  return [];
}

async function postToN8n(payload: N8nEmailPayload): Promise<number> {
  const response = await fetch(getAspireN8nWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `n8n webhook failed (${response.status}): ${text.slice(0, 400)}`,
    );
  }
  return response.status;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function emailAutomationsCallbackUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/aspire/email-automations/run?token=${encodeURIComponent(token)}`;
}

async function dispatchToN8n(input: {
  automation: EmailAutomationId;
  taskId: string;
  action: "send_email" | "schedule_only";
  callbackUrl?: string | null;
  requireCondition?: boolean;
  startedAtMs?: number;
  daysElapsed?: number;
  trigger?: "clickup_webhook" | "daily_scan";
  delayBeforeN8nMs?: number;
}): Promise<AutomationRunResult> {
  const { task, fields } = await loadClientFields(input.taskId);
  const condition = conditionFor(input.automation);
  const startedAtMs = input.startedAtMs;
  const trigger = input.trigger ?? "clickup_webhook";

  if (input.requireCondition && condition && !condition.check(fields)) {
    return {
      automation: input.automation,
      taskId: input.taskId,
      skipped: true,
      reason: `Condition failed: expected ${condition.reason}, got assessmentStage="${fields.assessmentStage}" status="${fields.status}"`,
    };
  }

  if (input.automation === EMAIL_AUTOMATIONS.waitingListDay0 && startedAtMs) {
    const stamped = await stampWaitingListStart(task, startedAtMs);
    if (stamped.sent.has(EMAIL_AUTOMATIONS.waitingListDay0)) {
      return {
        automation: input.automation,
        taskId: input.taskId,
        skipped: true,
        reason: "Waiting list day 0 email was already sent for this stint",
      };
    }
  }

  if (input.automation === EMAIL_AUTOMATIONS.noTechAssigned && startedAtMs) {
    await stampNoTechStart(task, startedAtMs);
  }

  if (trigger === "daily_scan") {
    const fieldIds = await ensureAutomationFieldIds();
    const latest = await getClickUpTask(input.taskId);
    const state = readScheduleState(latest, fieldIds);
    if (state.sent.has(input.automation)) {
      return {
        automation: input.automation,
        taskId: input.taskId,
        skipped: true,
        reason: `${input.automation} was already marked sent`,
      };
    }
  }

  let email: EmailContent | null = null;
  if (input.action === "send_email") {
    const built = buildEmail(input.automation, fields);
    if ("error" in built) {
      return {
        automation: input.automation,
        taskId: input.taskId,
        skipped: true,
        reason: built.error,
      };
    }
    email = built;
  }

  if (input.delayBeforeN8nMs && input.delayBeforeN8nMs > 0) {
    await wait(input.delayBeforeN8nMs);
  }

  const n8nStatus = await postToN8n({
    source: "aspire",
    action: input.action,
    automation: input.automation,
    taskId: task.id,
    taskUrl: taskUrlOf(task),
    trigger,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : null,
    daysElapsed: input.daysElapsed ?? null,
    email,
    fields,
    followUps: followUpsFor(input.automation),
    callback: input.callbackUrl
      ? { url: input.callbackUrl, method: "POST" }
      : null,
  });

  if (input.action === "send_email") {
    await markAutomationSent(task.id, input.automation);
  }

  return {
    automation: input.automation,
    taskId: task.id,
    skipped: false,
    n8nStatus,
  };
}

function historyDateMs(item: ClickUpHistoryItem): number {
  const raw = item.date;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function historyItemsOf(body: JsonObject): ClickUpHistoryItem[] {
  if (!Array.isArray(body.history_items)) return [];
  return body.history_items.filter(
    (item): item is ClickUpHistoryItem =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

export async function processClickUpTaskEvent(
  body: unknown,
  callbackUrl?: string | null,
): Promise<{
  skipped: boolean;
  reason?: string;
  results: AutomationRunResult[];
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { skipped: true, reason: "Invalid ClickUp webhook payload", results: [] };
  }

  const record = body as JsonObject;
  const taskId =
    typeof record.task_id === "string"
      ? record.task_id
      : typeof record.taskId === "string"
        ? record.taskId
        : "";
  if (!taskId) {
    return { skipped: true, reason: "ClickUp webhook is missing task_id", results: [] };
  }

  const results: AutomationRunResult[] = [];
  const seen = new Set<string>();
  const event = typeof record.event === "string" ? record.event : "";

  for (const item of historyItemsOf(record)) {
    const key = `${item.field || ""}:${item.id || JSON.stringify(item.after)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fieldId = item.custom_field?.id || "";
    const isAssessmentStageChange =
      fieldId === CLICKUP_FIELDS.assessmentStage ||
      ((item.field === "custom_field" || item.field === "Assessment stage") &&
        (!fieldId || fieldId === CLICKUP_FIELDS.assessmentStage));

    if (isAssessmentStageChange) {
      if (
        changedTo(item.before, item.after, (value) =>
          matchesAssessmentOption(value, CLICKUP_ASSESSMENT_STAGE.waitingList),
        )
      ) {
        results.push(
          await dispatchToN8n({
            automation: EMAIL_AUTOMATIONS.waitingListDay0,
            taskId,
            action: "send_email",
            callbackUrl,
            requireCondition: false,
            startedAtMs: historyDateMs(item),
            daysElapsed: 0,
            trigger: "clickup_webhook",
          }),
        );
      }

      if (
        changedTo(item.before, item.after, (value) =>
          matchesAssessmentOption(value, CLICKUP_ASSESSMENT_STAGE.assignedBcba),
        )
      ) {
        results.push(
          await dispatchToN8n({
            automation: EMAIL_AUTOMATIONS.bcbaAssigned,
            taskId,
            action: "send_email",
            callbackUrl,
            requireCondition: false,
            startedAtMs: historyDateMs(item),
            daysElapsed: 0,
            trigger: "clickup_webhook",
          }),
        );
      }
    }

    if (item.field === "status") {
      if (
        changedTo(
          item.before,
          item.after,
          (value) => statusName(value).toLowerCase() === CLICKUP_NO_TECH_STATUS,
        )
      ) {
        results.push(
          await dispatchToN8n({
            automation: EMAIL_AUTOMATIONS.noTechAssigned,
            taskId,
            action: "schedule_only",
            callbackUrl,
            requireCondition: false,
            startedAtMs: historyDateMs(item),
            daysElapsed: 0,
            trigger: "clickup_webhook",
          }),
        );
      }
    }
  }

  if (results.length === 0 && event === "taskCreated") {
    const { fields } = await loadClientFields(taskId);
    if (stillWaitingList(fields)) {
      results.push(
        await dispatchToN8n({
          automation: EMAIL_AUTOMATIONS.waitingListDay0,
          taskId,
          action: "send_email",
          callbackUrl,
          requireCondition: false,
          startedAtMs: Date.now(),
          daysElapsed: 0,
          trigger: "clickup_webhook",
        }),
      );
    } else if (
      fields.assessmentStage.toLowerCase() ===
      CLICKUP_ASSESSMENT_STAGE.assignedBcba.name.toLowerCase()
    ) {
      results.push(
        await dispatchToN8n({
          automation: EMAIL_AUTOMATIONS.bcbaAssigned,
          taskId,
          action: "send_email",
          callbackUrl,
          requireCondition: false,
          startedAtMs: Date.now(),
          daysElapsed: 0,
          trigger: "clickup_webhook",
        }),
      );
    }
    if (stillNoTech(fields)) {
      results.push(
        await dispatchToN8n({
          automation: EMAIL_AUTOMATIONS.noTechAssigned,
          taskId,
          action: "schedule_only",
          callbackUrl,
          requireCondition: false,
          startedAtMs: Date.now(),
          daysElapsed: 0,
          trigger: "clickup_webhook",
        }),
      );
    }
  }

  if (results.length === 0) {
    return {
      skipped: true,
      reason: "No matching Assessment stage or Status change",
      results,
    };
  }

  return { skipped: false, results };
}

export async function runScheduledAutomation(input: {
  taskId: string;
  automation: string;
  callbackUrl?: string | null;
}): Promise<AutomationRunResult> {
  const automation = input.automation.trim() as EmailAutomationId;
  const known = new Set<string>(Object.values(EMAIL_AUTOMATIONS));
  if (!known.has(automation)) {
    return {
      automation: automation || EMAIL_AUTOMATIONS.waitingListDay0,
      taskId: input.taskId,
      skipped: true,
      reason: `Unknown automation "${input.automation}"`,
    };
  }

  if (automation === EMAIL_AUTOMATIONS.noTechAssigned) {
    return dispatchToN8n({
      automation,
      taskId: input.taskId,
      action: "schedule_only",
      callbackUrl: input.callbackUrl,
      requireCondition: true,
      trigger: "daily_scan",
    });
  }

  return dispatchToN8n({
    automation,
    taskId: input.taskId,
    action: "send_email",
    callbackUrl: input.callbackUrl,
    requireCondition: true,
    trigger: "daily_scan",
  });
}

export async function scanEmailAutomations(callbackUrl?: string | null): Promise<{
  scannedAt: string;
  unstamped: Array<{ taskId: string; kind: "waiting_list" | "no_tech" }>;
  results: AutomationRunResult[];
}> {
  const { due, unstamped } = await collectDueEmailAutomations();
  const results: AutomationRunResult[] = [];
  let n8nPosts = 0;

  for (const item of due) {
    const result = await dispatchToN8n({
      automation: item.automation,
      taskId: item.taskId,
      action: "send_email",
      callbackUrl,
      requireCondition: true,
      startedAtMs: item.startedAtMs,
      daysElapsed: item.daysElapsed,
      trigger: "daily_scan",
      delayBeforeN8nMs: n8nPosts > 0 ? 1000 : 0,
    });
    results.push(result);
    if (!result.skipped) n8nPosts += 1;
  }

  return {
    scannedAt: new Date().toISOString(),
    unstamped,
    results,
  };
}

export function parseRunRequest(body: unknown): {
  taskId: string;
  automation: string;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as JsonObject;
  const taskId =
    typeof record.taskId === "string"
      ? record.taskId.trim()
      : typeof record.task_id === "string"
        ? record.task_id.trim()
        : "";
  const automation =
    typeof record.automation === "string"
      ? record.automation.trim()
      : typeof record.job === "string"
        ? record.job.trim()
        : "";
  if (!taskId || !automation) return null;
  return { taskId, automation };
}
