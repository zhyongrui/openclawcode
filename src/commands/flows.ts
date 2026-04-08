import { loadConfig } from "../config/config.js";
import { info } from "../globals.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { listTasksForFlowId } from "../tasks/runtime-internal.js";
import { cancelFlowById, getFlowTaskSummary } from "../tasks/task-executor.js";
import type { TaskFlowRecord, TaskFlowStatus } from "../tasks/task-flow-registry.types.js";
import {
  buildBackgroundSessionCompletionRouting,
  buildBackgroundSessionTranscriptHandoff,
  describeBackgroundChildSessions,
  formatBackgroundChildSessionGroupLines,
} from "./background-session-resume.js";
import {
  formatSessionLifecycleStatusLabel,
  inspectDetachedSessionLifecycle,
  type SessionLifecycleAssessment,
} from "./sessions.js";
import {
  getTaskFlowById,
  listTaskFlowRecords,
  resolveTaskFlowForLookupToken,
} from "../tasks/task-flow-runtime-internal.js";
import { sanitizeTaskStatusText } from "../tasks/task-status.js";
import { sanitizeTerminalText } from "../terminal/safe-text.js";
import { isRich, theme } from "../terminal/theme.js";

const ID_PAD = 10;
const STATUS_PAD = 10;
const MODE_PAD = 14;
const REV_PAD = 6;
const CTRL_PAD = 20;
const SESSION_PAD = 16;

type FlowListRow = TaskFlowRecord & {
  detachedLifecycle?: SessionLifecycleAssessment | null;
  sessionResume?: import("./background-session-resume.js").BackgroundSessionResumeDetail | null;
};

type FlowLookupResolution = {
  resolvedBy: "flow_id" | "owner_key";
};

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

function safeFlowDisplayText(value: string | undefined, maxChars?: number): string {
  const sanitized = sanitizeTerminalText(value ?? "").trim();
  if (!sanitized) {
    return "n/a";
  }
  return typeof maxChars === "number" ? truncate(sanitized, maxChars) : sanitized;
}

function safeFlowStateDisplayText(
  value: string | undefined,
  flow: Pick<TaskFlowRecord, "status">,
): string {
  const sanitized =
    sanitizeTaskStatusText(value, {
      errorContext: flow.status === "blocked" || flow.status === "failed" || flow.status === "lost",
    }) || "";
  return safeFlowDisplayText(sanitized);
}

function shortToken(value: string | undefined, maxChars = ID_PAD): string {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return "n/a";
  }
  return truncate(trimmed, maxChars);
}

function resolveFlowLookupResolution(token: string): FlowLookupResolution | null {
  const lookup = token.trim();
  if (!lookup) {
    return null;
  }
  if (getTaskFlowById(lookup)) {
    return { resolvedBy: "flow_id" };
  }
  if (resolveTaskFlowForLookupToken(lookup)) {
    return { resolvedBy: "owner_key" };
  }
  return null;
}

function formatFlowStatusCell(status: TaskFlowStatus, rich: boolean) {
  const padded = status.padEnd(STATUS_PAD);
  if (!rich) {
    return padded;
  }
  if (status === "succeeded") {
    return theme.success(padded);
  }
  if (status === "failed" || status === "lost") {
    return theme.error(padded);
  }
  if (status === "running") {
    return theme.accentBright(padded);
  }
  if (status === "blocked") {
    return theme.warn(padded);
  }
  return theme.muted(padded);
}

function formatFlowSessionLifecycleCell(
  lifecycle: SessionLifecycleAssessment | null | undefined,
  rich: boolean,
) {
  const label = lifecycle
    ? formatSessionLifecycleStatusLabel(lifecycle.status).padEnd(SESSION_PAD)
    : "n/a".padEnd(SESSION_PAD);
  if (!rich || !lifecycle) {
    return label;
  }
  if (lifecycle.status === "blocked_detached" || lifecycle.status === "missing_transcript") {
    return theme.warn(label);
  }
  if (lifecycle.status === "running_detached") {
    return theme.accentBright(label);
  }
  if (lifecycle.status === "aborted_last_run") {
    return theme.error(label);
  }
  if (lifecycle.status === "waiting_detached" || lifecycle.status === "resumable") {
    return theme.success(label);
  }
  return theme.muted(label);
}

function formatFlowRows(flows: FlowListRow[], rich: boolean) {
  const header = [
    "TaskFlow".padEnd(ID_PAD),
    "Mode".padEnd(MODE_PAD),
    "Status".padEnd(STATUS_PAD),
    "Session".padEnd(SESSION_PAD),
    "Rev".padEnd(REV_PAD),
    "Controller".padEnd(CTRL_PAD),
    "Tasks".padEnd(14),
    "Goal",
  ].join(" ");
  const lines = [rich ? theme.heading(header) : header];
  for (const flow of flows) {
    const taskSummary = getFlowTaskSummary(flow.flowId);
    const counts = `${taskSummary.active} active/${taskSummary.total} total`;
    lines.push(
      [
        shortToken(flow.flowId).padEnd(ID_PAD),
        flow.syncMode.padEnd(MODE_PAD),
        formatFlowStatusCell(flow.status, rich),
        formatFlowSessionLifecycleCell(flow.detachedLifecycle, rich),
        String(flow.revision).padEnd(REV_PAD),
        safeFlowDisplayText(flow.controllerId, CTRL_PAD).padEnd(CTRL_PAD),
        counts.padEnd(14),
        safeFlowDisplayText(flow.goal, 80),
      ].join(" "),
    );
  }
  return lines;
}

function formatFlowListSummary(flows: TaskFlowRecord[]) {
  const active = flows.filter(
    (flow) => flow.status === "queued" || flow.status === "running",
  ).length;
  const blocked = flows.filter((flow) => flow.status === "blocked").length;
  const cancelRequested = flows.filter((flow) => flow.cancelRequestedAt != null).length;
  return `${active} active · ${blocked} blocked · ${cancelRequested} cancel-requested · ${flows.length} total`;
}

function summarizeWait(flow: TaskFlowRecord): string {
  if (flow.waitJson == null) {
    return "n/a";
  }
  if (
    typeof flow.waitJson === "string" ||
    typeof flow.waitJson === "number" ||
    typeof flow.waitJson === "boolean"
  ) {
    return String(flow.waitJson);
  }
  if (Array.isArray(flow.waitJson)) {
    return `array(${flow.waitJson.length})`;
  }
  return Object.keys(flow.waitJson).toSorted().join(", ") || "object";
}

function summarizeFlowState(flow: TaskFlowRecord): string | null {
  if (flow.status === "blocked") {
    if (flow.blockedSummary) {
      return flow.blockedSummary;
    }
    if (flow.blockedTaskId) {
      return `blocked by ${flow.blockedTaskId}`;
    }
    return "blocked";
  }
  if (flow.status === "waiting" && flow.waitJson != null) {
    return summarizeWait(flow);
  }
  return null;
}

export async function flowsListCommand(
  opts: { json?: boolean; status?: string },
  runtime: RuntimeEnv,
) {
  const cfg = loadConfig();
  const statusFilter = opts.status?.trim();
  const flows = listTaskFlowRecords().filter((flow) => {
    if (statusFilter && flow.status !== statusFilter) {
      return false;
    }
    return true;
  });
  const rows: FlowListRow[] = flows.map((flow) => {
    const snapshot = parseAgentSessionKey(flow.ownerKey)
      ? inspectDetachedSessionLifecycle({
          cfg,
          sessionKey: flow.ownerKey,
        })
      : undefined;
    return {
      ...flow,
      detachedLifecycle: snapshot?.lifecycle ?? null,
      sessionResume: snapshot?.resumeDetail ?? null,
    };
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          count: rows.length,
          status: statusFilter ?? null,
          flows: rows.map((flow) => ({
            ...flow,
            tasks: listTasksForFlowId(flow.flowId),
            taskSummary: getFlowTaskSummary(flow.flowId),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(info(`TaskFlows: ${rows.length}`));
  runtime.log(info(`TaskFlow pressure: ${formatFlowListSummary(flows)}`));
  if (statusFilter) {
    runtime.log(info(`Status filter: ${statusFilter}`));
  }
  if (rows.length === 0) {
    runtime.log("No TaskFlows found.");
    return;
  }
  const rich = isRich();
  for (const line of formatFlowRows(rows, rich)) {
    runtime.log(line);
  }
}

export async function flowsShowCommand(
  opts: { json?: boolean; lookup: string },
  runtime: RuntimeEnv,
) {
  const cfg = loadConfig();
  const lookup = opts.lookup.trim();
  const resolution = resolveFlowLookupResolution(lookup);
  const flow = resolveTaskFlowForLookupToken(lookup);
  if (!flow) {
    runtime.error(`TaskFlow not found: ${opts.lookup}`);
    runtime.exit(1);
    return;
  }
  const tasks = listTasksForFlowId(flow.flowId);
  const taskSummary = getFlowTaskSummary(flow.flowId);
  const stateSummary = summarizeFlowState(flow);
  const completionRouting = buildBackgroundSessionCompletionRouting({
    reattachedAt: flow.reattachedAt,
  });
  const detachedLifecycle = parseAgentSessionKey(flow.ownerKey)
    ? (inspectDetachedSessionLifecycle({
        cfg,
        sessionKey: flow.ownerKey,
      })?.lifecycle ?? null)
    : null;
  const completionRoutingBySessionKey = new Map(
    tasks.flatMap((task) =>
      task.childSessionKey?.trim()
        ? [
            [
              task.childSessionKey.trim(),
              buildBackgroundSessionCompletionRouting({
                reattachedAt: task.reattachedAt ?? flow.reattachedAt,
              }),
            ] as const,
          ]
        : [],
    ),
  );
  const childSessionLines = formatBackgroundChildSessionGroupLines({
    cfg,
    sessionKeys: tasks.map((task) => task.childSessionKey),
    completionRoutingBySessionKey,
  });
  const childSessions = describeBackgroundChildSessions({
    cfg,
    sessionKeys: tasks.map((task) => task.childSessionKey),
    completionRoutingBySessionKey,
  });
  const transcriptHandoff = buildBackgroundSessionTranscriptHandoff({
    transcriptExists: childSessions.some((session) => session.transcriptExists),
    completionRouting,
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          lookup,
          resolvedBy: resolution?.resolvedBy ?? null,
          ...flow,
          transcriptHandoff,
          completionRouting,
          detachedLifecycle,
          childSessions,
          tasks,
          taskSummary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = [
    "TaskFlow:",
    `lookup: ${lookup}`,
    ...(resolution ? [`resolvedBy: ${resolution.resolvedBy}`] : []),
    `flowId: ${flow.flowId}`,
    `status: ${flow.status}`,
    `goal: ${safeFlowDisplayText(flow.goal)}`,
    `currentStep: ${safeFlowDisplayText(flow.currentStep)}`,
    `owner: ${safeFlowDisplayText(flow.ownerKey)}`,
    `transcriptHandoff: ${transcriptHandoff.mode}`,
    `transcriptHandoffSummary: ${safeFlowDisplayText(transcriptHandoff.summary)}`,
    `completionRouting: ${completionRouting.mode}`,
    `completionRoutingSummary: ${safeFlowDisplayText(completionRouting.summary)}`,
    ...(detachedLifecycle
      ? [
          `sessionLifecycle: ${detachedLifecycle.status}`,
          `sessionLifecycleSummary: ${safeFlowDisplayText(detachedLifecycle.summary)}`,
        ]
      : []),
    `notify: ${flow.notifyPolicy}`,
    ...(stateSummary ? [`state: ${safeFlowStateDisplayText(stateSummary, flow)}`] : []),
    ...(flow.cancelRequestedAt
      ? [`cancelRequestedAt: ${new Date(flow.cancelRequestedAt).toISOString()}`]
      : []),
    `reattachedAt: ${flow.reattachedAt ? new Date(flow.reattachedAt).toISOString() : "n/a"}`,
    `createdAt: ${new Date(flow.createdAt).toISOString()}`,
    `updatedAt: ${new Date(flow.updatedAt).toISOString()}`,
    `endedAt: ${flow.endedAt ? new Date(flow.endedAt).toISOString() : "n/a"}`,
    `tasks: ${taskSummary.total} total · ${taskSummary.active} active · ${taskSummary.failures} issues`,
  ];
  for (const line of lines) {
    runtime.log(line);
  }
  for (const line of childSessionLines) {
    runtime.log(line);
  }
  if (tasks.length === 0) {
    runtime.log("Linked tasks: none");
    return;
  }
  runtime.log("Linked tasks:");
  for (const task of tasks) {
    const safeLabel = safeFlowDisplayText(task.label ?? task.task);
    runtime.log(`- ${task.taskId} ${task.status} ${task.runId ?? "n/a"} ${safeLabel}`);
  }
}

export async function flowsCancelCommand(opts: { lookup: string }, runtime: RuntimeEnv) {
  const flow = resolveTaskFlowForLookupToken(opts.lookup);
  if (!flow) {
    runtime.error(`Flow not found: ${opts.lookup}`);
    runtime.exit(1);
    return;
  }
  const result = await cancelFlowById({
    cfg: loadConfig(),
    flowId: flow.flowId,
  });
  if (!result.found) {
    runtime.error(result.reason ?? `Flow not found: ${opts.lookup}`);
    runtime.exit(1);
    return;
  }
  if (!result.cancelled) {
    runtime.error(result.reason ?? `Could not cancel TaskFlow: ${opts.lookup}`);
    runtime.exit(1);
    return;
  }
  const updated = getTaskFlowById(flow.flowId) ?? result.flow ?? flow;
  runtime.log(`Cancelled ${updated.flowId} (${updated.syncMode}) with status ${updated.status}.`);
}
