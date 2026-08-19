import {
  ASPIRE_SCHEDULE_TIMEZONE,
  CLICKUP_ASSESSMENT_STAGE,
  CLICKUP_AUTOMATION_FIELD_NAMES,
  CLICKUP_FIELDS,
  CLICKUP_NO_TECH_STATUS,
  EMAIL_AUTOMATIONS,
  type EmailAutomationId,
} from "./config";
import {
  createClickUpListField,
  getClickUpTask,
  listClickUpListFields,
  searchClickUpListTasks,
  setClickUpCustomField,
  type ClickUpTask,
  type ClickUpTaskCustomField,
} from "./clickup";

export type AutomationFieldIds = {
  waitingListDateId: string;
  noTechDateId: string;
  followUpsSentId: string;
};

export type TaskScheduleState = {
  waitingListSinceMs: number | null;
  noTechSinceMs: number | null;
  sent: Set<string>;
};

const WAITING_LIST_DUE: Array<{ automation: EmailAutomationId; days: number }> = [
  { automation: EMAIL_AUTOMATIONS.waitingListDay10, days: 10 },
  { automation: EMAIL_AUTOMATIONS.waitingListDay20, days: 20 },
  { automation: EMAIL_AUTOMATIONS.waitingListDay30, days: 30 },
];

const NO_TECH_DUE: Array<{ automation: EmailAutomationId; days: number }> = [
  { automation: EMAIL_AUTOMATIONS.noTechDay15, days: 15 },
  { automation: EMAIL_AUTOMATIONS.noTechDay20, days: 20 },
  { automation: EMAIL_AUTOMATIONS.noTechDay25, days: 25 },
];

// TESTING: n8n runs hourly. Treat the thresholds above as hours instead of
// calendar days (e.g. waiting-list day 10 = 10 hours). Switch back to days:
// set this to false.
const USE_HOURS_INSTEAD_OF_DAYS_FOR_TESTING = true;

let cachedFieldIds: AutomationFieldIds | null = null;

function fieldById(
  task: ClickUpTask,
  fieldId: string,
): ClickUpTaskCustomField | undefined {
  return task.custom_fields?.find((field) => field.id === fieldId);
}

function parseDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseSent(value: unknown): Set<string> {
  if (typeof value !== "string" || !value.trim()) return new Set();
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function serializeSent(sent: Set<string>): string {
  return [...sent].sort().join(",");
}

export function calendarDaysSince(
  startedAtMs: number,
  nowMs = Date.now(),
  timeZone = ASPIRE_SCHEDULE_TIMEZONE,
): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const from = fmt.format(new Date(startedAtMs));
  const to = fmt.format(new Date(nowMs));
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function hoursElapsed(startedAtMs: number, nowMs = Date.now()): number {
  return Math.floor((nowMs - startedAtMs) / 3_600_000);
}

function scheduleElapsed(startedAtMs: number): number {
  // TESTING: hours instead of days so hourly n8n scans can fire follow-ups.
  // Switch back: USE_HOURS_INSTEAD_OF_DAYS_FOR_TESTING = false.
  return USE_HOURS_INSTEAD_OF_DAYS_FOR_TESTING
    ? hoursElapsed(startedAtMs)
    : calendarDaysSince(startedAtMs);
}

async function findOrCreateField(
  existing: Array<{ id: string; name: string; type: string }>,
  name: string,
  type: string,
): Promise<{ id: string; name: string; type: string }> {
  const match = existing.find(
    (field) => field.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (match) return match;
  return createClickUpListField({ name, type });
}

export async function ensureAutomationFieldIds(): Promise<AutomationFieldIds> {
  if (cachedFieldIds) return cachedFieldIds;

  const existing = await listClickUpListFields();
  const waitingList = await findOrCreateField(
    existing,
    CLICKUP_AUTOMATION_FIELD_NAMES.waitingListDate,
    "date",
  );
  const noTech = await findOrCreateField(
    existing,
    CLICKUP_AUTOMATION_FIELD_NAMES.noTechDate,
    "date",
  );
  const sent = await findOrCreateField(
    existing,
    CLICKUP_AUTOMATION_FIELD_NAMES.followUpsSent,
    "short_text",
  );

  cachedFieldIds = {
    waitingListDateId: waitingList.id,
    noTechDateId: noTech.id,
    followUpsSentId: sent.id,
  };
  return cachedFieldIds;
}

export function readScheduleState(
  task: ClickUpTask,
  fieldIds: AutomationFieldIds,
): TaskScheduleState {
  return {
    waitingListSinceMs: parseDateMs(
      fieldById(task, fieldIds.waitingListDateId)?.value,
    ),
    noTechSinceMs: parseDateMs(fieldById(task, fieldIds.noTechDateId)?.value),
    sent: parseSent(fieldById(task, fieldIds.followUpsSentId)?.value),
  };
}

export async function writeSentFlags(
  taskId: string,
  fieldIds: AutomationFieldIds,
  sent: Set<string>,
): Promise<void> {
  await setClickUpCustomField(
    taskId,
    fieldIds.followUpsSentId,
    serializeSent(sent),
  );
}

function isRetryStamp(existingMs: number | null, nextMs: number): boolean {
  if (existingMs == null) return false;
  return Math.abs(existingMs - nextMs) < 60 * 60 * 1000;
}

function clearPrefix(sent: Set<string>, prefix: string): Set<string> {
  const next = new Set<string>();
  for (const value of sent) {
    if (!value.startsWith(prefix)) next.add(value);
  }
  return next;
}

export async function stampWaitingListStart(
  task: ClickUpTask,
  startedAtMs: number,
): Promise<{ fieldIds: AutomationFieldIds; sent: Set<string>; isRetry: boolean }> {
  const fieldIds = await ensureAutomationFieldIds();
  const current = readScheduleState(task, fieldIds);
  const retry = isRetryStamp(current.waitingListSinceMs, startedAtMs);
  const sent = retry ? current.sent : clearPrefix(current.sent, "waiting_list_");

  if (!retry) {
    await setClickUpCustomField(task.id, fieldIds.waitingListDateId, startedAtMs, {
      time: true,
    });
    await writeSentFlags(task.id, fieldIds, sent);
  }

  return { fieldIds, sent, isRetry: retry };
}

export async function stampNoTechStart(
  task: ClickUpTask,
  startedAtMs: number,
): Promise<{ fieldIds: AutomationFieldIds; sent: Set<string>; isRetry: boolean }> {
  const fieldIds = await ensureAutomationFieldIds();
  const current = readScheduleState(task, fieldIds);
  const retry = isRetryStamp(current.noTechSinceMs, startedAtMs);
  const sent = retry ? current.sent : clearPrefix(current.sent, "no_tech_");

  if (!retry) {
    await setClickUpCustomField(task.id, fieldIds.noTechDateId, startedAtMs, {
      time: true,
    });
    await writeSentFlags(task.id, fieldIds, sent);
  }

  return { fieldIds, sent, isRetry: retry };
}

export async function markAutomationSent(
  taskId: string,
  automation: EmailAutomationId,
): Promise<void> {
  const fieldIds = await ensureAutomationFieldIds();
  const task = await getClickUpTask(taskId);
  const state = readScheduleState(task, fieldIds);
  state.sent.add(automation);
  await writeSentFlags(taskId, fieldIds, state.sent);
}

export function dueWaitingListAutomations(
  daysElapsed: number,
  sent: Set<string>,
): EmailAutomationId[] {
  return WAITING_LIST_DUE.filter(
    (item) => daysElapsed >= item.days && !sent.has(item.automation),
  ).map((item) => item.automation);
}

export function dueNoTechAutomations(
  daysElapsed: number,
  sent: Set<string>,
): EmailAutomationId[] {
  return NO_TECH_DUE.filter(
    (item) => daysElapsed >= item.days && !sent.has(item.automation),
  ).map((item) => item.automation);
}

function isNoTechTask(task: ClickUpTask): boolean {
  return (task.status?.status || "").trim().toLowerCase() === CLICKUP_NO_TECH_STATUS;
}

export type ScanCandidate = {
  taskId: string;
  automation: EmailAutomationId;
  daysElapsed: number;
  startedAtMs: number;
  stampedNow?: boolean;
};

export async function collectDueEmailAutomations(): Promise<{
  fieldIds: AutomationFieldIds;
  due: ScanCandidate[];
  unstamped: Array<{ taskId: string; kind: "waiting_list" | "no_tech" }>;
}> {
  const fieldIds = await ensureAutomationFieldIds();
  const [waitingListTasks, noTechTasks] = await Promise.all([
    searchClickUpListTasks({
      customFields: [
        {
          field_id: CLICKUP_FIELDS.assessmentStage,
          operator: "=",
          value: CLICKUP_ASSESSMENT_STAGE.waitingList.id,
        },
      ],
    }),
    searchClickUpListTasks({
      statuses: [CLICKUP_NO_TECH_STATUS],
    }),
  ]);

  const due: ScanCandidate[] = [];
  const unstamped: Array<{ taskId: string; kind: "waiting_list" | "no_tech" }> = [];

  for (const task of waitingListTasks) {
    const state = readScheduleState(task, fieldIds);
    let stampedNow = false;
    let startedAtMs = state.waitingListSinceMs;
    if (startedAtMs == null) {
      startedAtMs = Date.now();
      await stampWaitingListStart(task, startedAtMs);
      await markAutomationSent(task.id, EMAIL_AUTOMATIONS.waitingListDay0);
      state.sent.add(EMAIL_AUTOMATIONS.waitingListDay0);
      stampedNow = true;
      unstamped.push({ taskId: task.id, kind: "waiting_list" });
    }

    const daysElapsed = scheduleElapsed(startedAtMs);
    for (const automation of dueWaitingListAutomations(daysElapsed, state.sent)) {
      due.push({
        taskId: task.id,
        automation,
        daysElapsed,
        startedAtMs,
        stampedNow,
      });
    }
  }

  for (const task of noTechTasks) {
    if (!isNoTechTask(task)) continue;
    const state = readScheduleState(task, fieldIds);
    let stampedNow = false;
    let startedAtMs = state.noTechSinceMs;
    if (startedAtMs == null) {
      startedAtMs = Date.now();
      await stampNoTechStart(task, startedAtMs);
      stampedNow = true;
      unstamped.push({ taskId: task.id, kind: "no_tech" });
    }

    const daysElapsed = scheduleElapsed(startedAtMs);
    for (const automation of dueNoTechAutomations(daysElapsed, state.sent)) {
      due.push({
        taskId: task.id,
        automation,
        daysElapsed,
        startedAtMs,
        stampedNow,
      });
    }
  }

  return { fieldIds, due, unstamped };
}
