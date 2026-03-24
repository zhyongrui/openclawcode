import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowFailureDiagnostics,
  WorkflowLoopHealthStatus,
  WorkflowQualityGateStatus,
  SuitabilityDecision,
  WorkflowHandoffEntry,
  WorkflowRun,
  WorkflowStage,
} from "../../openclawcode/contracts/index.js";
import {
  deriveWorkflowLoopHealth,
  deriveWorkflowPreCodeDiscipline,
  deriveWorkflowQualityGate,
  resolveAutoMergeDisposition,
  resolveAutoMergePolicy,
} from "../../openclawcode/index.js";
import type { WorkflowPreCodeDisciplineStatus } from "../../openclawcode/index.js";
import type { OpenClawCodeScopedIssueDraft } from "./chatops.js";
import type { OpenClawCodeChatopsRunRequest } from "./chatops.js";

export interface OpenClawCodeQueuedRun {
  request: OpenClawCodeChatopsRunRequest;
  notifyChannel: string;
  notifyTarget: string;
  issueKey: string;
}

export type OpenClawCodePendingApprovalKind = "manual" | "execution-start-gated";

export interface OpenClawCodePendingApproval {
  issueKey: string;
  notifyChannel: string;
  notifyTarget: string;
  approvalKind?: OpenClawCodePendingApprovalKind;
}

export interface OpenClawCodePendingIntakeDraft {
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
  title: string;
  body: string;
  sourceRequest: string;
  bodySynthesized: boolean;
  scopedDrafts: OpenClawCodeScopedIssueDraft[];
  clarificationQuestions: string[];
  clarificationSuggestions: string[];
  clarificationResponses: OpenClawCodePendingIntakeClarificationResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenClawCodePendingIntakeClarificationResponse {
  question: string;
  answer: string;
  answeredAt: string;
}

export type OpenClawCodeSetupSessionStage =
  | "drafting-blueprint"
  | "awaiting-repo-choice"
  | "awaiting-chat-pairing"
  | "awaiting-github-device-auth"
  | "github-authenticated"
  | "repo-missing-blueprint-required"
  | "repo-existing-blueprint-detected"
  | "repo-nonstandard-context-detected"
  | "repo-creation-pending"
  | "bootstrap-ready"
  | "bootstrap-complete";

export interface OpenClawCodeSetupSession {
  notifyChannel: string;
  notifyTarget: string;
  projectMode?: "existing-repo" | "new-project";
  repoKey?: string;
  pendingRepoName?: string;
  stage: OpenClawCodeSetupSessionStage;
  githubAuthSource?: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
  githubAuthLogin?: string;
  githubAuthName?: string;
  githubAuthEmail?: string;
  blueprintDraft?: {
    status?: "draft" | "agreed";
    agreedAt?: string;
    repoNameSuggestions?: string[];
    sourcePaths?: string[];
    sections?: Record<string, string>;
  };
  detectedBlueprint?: {
    sourcePath?: string;
    title?: string;
    status?: string;
    goalSummary?: string;
    workstreamCandidateCount?: number;
    openQuestionCount?: number;
    humanGateCount?: number;
  };
  lastFailure?: {
    step: "github-auth" | "repo-create" | "bootstrap" | "blueprint-sync";
    reason: string;
    occurredAt: string;
  };
  bootstrap?: {
    completedAt: string;
    repoRoot?: string;
    checkoutAction?: string;
    blueprintPath?: string;
    blueprintStatus?: string;
    blueprintRevisionId?: string;
    blueprintGoalSummary?: string;
    workstreamCandidateCount?: number;
    openQuestionCount?: number;
    humanGateCount?: number;
    clarificationQuestions?: string[];
    clarificationSuggestions?: string[];
    nextAction?: string;
    cliRunCommand?: string | null;
    blueprintCommand?: string | null;
    blueprintClarifyCommand?: string | null;
    blueprintAgreeCommand?: string | null;
    blueprintDecomposeCommand?: string | null;
    gatesCommand?: string | null;
    gatewayRestartCommand?: string | null;
    pluginActivationRepairCommand?: string | null;
    chatSetupCommand?: string | null;
    chatSetupStatusCommand?: string | null;
    chatBindCommand?: string | null;
    chatStartCommand?: string | null;
    webhookRetryCommand?: string | null;
    recommendedProofMode?: "cli-only" | "chatops";
    reason?: string;
    autoBindStatus?: "bound" | "already-bound" | "existing-binding-kept";
    autoBindChannel?: string;
    autoBindTarget?: string;
    workItemCount?: number;
    plannedWorkItemCount?: number;
    readyForIssueProjection?: boolean;
    blockedGateCount?: number;
    needsHumanDecisionCount?: number;
    pluginActivation?: {
      ready?: boolean;
      pluginsEnabled?: boolean;
      allowlisted?: boolean;
      entryEnabled?: boolean;
    };
    firstWorkItemTitle?: string;
    nextSuggestedCommand?: string | null;
    proofReadiness?: {
      cliProofReady?: boolean;
      chatProofReady?: boolean;
      chatSetupRoutingReady?: boolean;
      webhookReady?: boolean;
      webhookUrlReady?: boolean;
      needsChatBind?: boolean;
      needsPublicWebhookUrl?: boolean;
      recommendedProofMode?: "cli-only" | "chatops";
    };
  };
  githubDeviceAuth?: {
    pid?: number;
    logPath: string;
    userCode?: string;
    verificationUri?: string;
    startedAt: string;
    completedAt?: string;
    failureReason?: string;
    notificationState?: "authorized" | "failed";
    notificationSentAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OpenClawCodeManualTakeover {
  issueKey: string;
  runId: string;
  stage: WorkflowStage;
  branchName?: string;
  worktreePath: string;
  notifyChannel: string;
  notifyTarget: string;
  actor?: string;
  note?: string;
  requestedAt: string;
}

export interface OpenClawCodeDeferredRuntimeReroute {
  issueKey: string;
  notifyChannel: string;
  notifyTarget: string;
  requestedAt: string;
  actor?: string;
  note?: string;
  sourceRunId?: string;
  sourceStage?: WorkflowStage;
  requestedCoderAgentId?: string;
  requestedVerifierAgentId?: string;
}

export interface OpenClawCodeIssueStatusSnapshot {
  issueKey: string;
  status: string;
  stage: WorkflowStage;
  runId: string;
  updatedAt: string;
  owner: string;
  repo: string;
  issueNumber: number;
  branchName?: string;
  worktreePath?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  notifyChannel?: string;
  notifyTarget?: string;
  latestReviewDecision?: "approved" | "changes-requested";
  latestReviewSubmittedAt?: string;
  latestReviewSummary?: string;
  latestReviewUrl?: string;
  rerunReason?: string;
  rerunRequestedAt?: string;
  rerunPriorRunId?: string;
  rerunPriorStage?: WorkflowStage;
  rerunRequestedCoderAgentId?: string;
  rerunRequestedVerifierAgentId?: string;
  rerunManualTakeoverRequestedAt?: string;
  rerunManualTakeoverActor?: string;
  rerunManualTakeoverWorktreePath?: string;
  rerunManualResumeNote?: string;
  runtimeRoutingSummary?: string;
  suitabilityDecision?: SuitabilityDecision;
  suitabilitySummary?: string;
  suitabilityAllowlisted?: boolean;
  suitabilityDenylisted?: boolean;
  suitabilityOverrideApplied?: boolean;
  suitabilityOverrideActor?: string;
  suitabilityOverrideReason?: string;
  handoffEntries?: WorkflowHandoffEntry[];
  autoMergePolicyEligible?: boolean;
  autoMergePolicyReason?: string;
  autoMergeDisposition?: "merged" | "skipped" | "failed";
  autoMergeDispositionReason?: string;
  qualityGateStatus?: WorkflowQualityGateStatus;
  qualityGateSummary?: string;
  qualityGateBlockingReasons?: string[];
  qualityGateWarningReasons?: string[];
  qualityGateFindingCount?: number;
  qualityGateMissingCoverageCount?: number;
  qualityGateFollowUpCount?: number;
  preCodeDisciplineStatus?: WorkflowPreCodeDisciplineStatus;
  preCodeDisciplineSummary?: string;
  preCodeDisciplineBlockingReasons?: string[];
  preCodeDisciplineWarningReasons?: string[];
  preCodeDisciplinePlanStatus?: "not-required" | "awaiting-approval" | "approved" | "missing";
  preCodeDisciplineExecutionSpecPresent?: boolean;
  preCodeDisciplineTestIntentPresent?: boolean;
  preCodeDisciplineTestIntentCount?: number;
  preCodeDisciplinePlanApprovalRequired?: boolean;
  preCodeDisciplinePlanEdited?: boolean;
  preCodeDisciplineIsolatedWorktreePrepared?: boolean;
  preCodeDisciplineModeSpecificContextsPresent?: boolean;
  preCodeDisciplineFreshRoleExecutionPresent?: boolean;
  loopHealthStatus?: WorkflowLoopHealthStatus;
  loopHealthSummary?: string;
  loopHealthBlockingReasons?: string[];
  loopHealthWarningReasons?: string[];
  loopHealthFailureSummary?: string;
  loopHealthPromptFootprintChars?: number;
  loopHealthBootstrapWarningShown?: boolean;
  loopHealthInjectedWorkspaceFileCount?: number;
  loopHealthLastCallUsageTotal?: number;
  failureDiagnostics?: WorkflowFailureDiagnostics;
  providerFailureCount?: number;
  lastProviderFailureAt?: string;
  providerPauseUntil?: string;
  providerPauseReason?: string;
  lastNotificationChannel?: string;
  lastNotificationTarget?: string;
  lastNotificationAt?: string;
  lastNotificationStatus?: "sent" | "failed";
  lastNotificationError?: string;
}

export interface OpenClawCodeRepoNotificationBinding {
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
  updatedAt: string;
}

export interface OpenClawCodeGitHubDeliveryRecord {
  deliveryId: string;
  eventName: string;
  action: string;
  accepted: boolean;
  reason: string;
  receivedAt: string;
  issueKey?: string;
  pullRequestNumber?: number;
}

export interface OpenClawCodeTransientProviderFailureRecord {
  issueKey: string;
  runId: string;
  failedAt: string;
  summary: string;
}

export interface OpenClawCodeProviderPause {
  until: string;
  triggeredAt: string;
  lastFailureAt: string;
  failureCount: number;
  reason: string;
}

export interface OpenClawCodeQueueState {
  version: 1;
  pendingApprovals: OpenClawCodePendingApproval[];
  pendingIntakeDrafts: OpenClawCodePendingIntakeDraft[];
  setupSessions: OpenClawCodeSetupSession[];
  manualTakeovers: OpenClawCodeManualTakeover[];
  deferredRuntimeReroutes: OpenClawCodeDeferredRuntimeReroute[];
  queue: OpenClawCodeQueuedRun[];
  currentRun?: OpenClawCodeQueuedRun;
  statusByIssue: Record<string, string>;
  statusSnapshotsByIssue: Record<string, OpenClawCodeIssueStatusSnapshot>;
  repoBindingsByRepo: Record<string, OpenClawCodeRepoNotificationBinding>;
  githubDeliveriesById: Record<string, OpenClawCodeGitHubDeliveryRecord>;
  recentProviderFailures: OpenClawCodeTransientProviderFailureRecord[];
  providerPause?: OpenClawCodeProviderPause;
}

const MAX_GITHUB_DELIVERY_RECORDS = 200;
const PROVIDER_FAILURE_WINDOW_MS = 15 * 60_000;
const PROVIDER_PAUSE_MS = 10 * 60_000;
const PROVIDER_FAILURE_THRESHOLD = 2;
const PROVIDER_INTERNAL_ERROR_PATTERN = /HTTP 400:\s*Internal server error/i;

function cloneDefaultState(): OpenClawCodeQueueState {
  return {
    version: 1,
    pendingApprovals: [],
    pendingIntakeDrafts: [],
    setupSessions: [],
    manualTakeovers: [],
    deferredRuntimeReroutes: [],
    queue: [],
    statusByIssue: {},
    statusSnapshotsByIssue: {},
    repoBindingsByRepo: {},
    githubDeliveriesById: {},
    recentProviderFailures: [],
  };
}

function normalizePendingIntakeDraft(raw: unknown): OpenClawCodePendingIntakeDraft | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodePendingIntakeDraft>;
  if (
    typeof candidate.repoKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    typeof candidate.sourceRequest !== "string" ||
    typeof candidate.bodySynthesized !== "boolean" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    repoKey: candidate.repoKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    title: candidate.title,
    body: candidate.body,
    sourceRequest: candidate.sourceRequest,
    bodySynthesized: candidate.bodySynthesized,
    scopedDrafts: Array.isArray(candidate.scopedDrafts)
      ? candidate.scopedDrafts.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const candidateDraft = entry as Partial<OpenClawCodeScopedIssueDraft>;
          if (
            typeof candidateDraft.title !== "string" ||
            typeof candidateDraft.body !== "string" ||
            typeof candidateDraft.reason !== "string"
          ) {
            return [];
          }
          return [
            {
              title: candidateDraft.title,
              body: candidateDraft.body,
              reason: candidateDraft.reason,
            } satisfies OpenClawCodeScopedIssueDraft,
          ];
        })
      : [],
    clarificationQuestions: Array.isArray(candidate.clarificationQuestions)
      ? candidate.clarificationQuestions.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    clarificationSuggestions: Array.isArray(candidate.clarificationSuggestions)
      ? candidate.clarificationSuggestions.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    clarificationResponses: Array.isArray(candidate.clarificationResponses)
      ? candidate.clarificationResponses.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const candidateResponse =
            entry as Partial<OpenClawCodePendingIntakeClarificationResponse>;
          if (
            typeof candidateResponse.question !== "string" ||
            typeof candidateResponse.answer !== "string" ||
            typeof candidateResponse.answeredAt !== "string"
          ) {
            return [];
          }
          return [
            {
              question: candidateResponse.question,
              answer: candidateResponse.answer,
              answeredAt: candidateResponse.answeredAt,
            } satisfies OpenClawCodePendingIntakeClarificationResponse,
          ];
        })
      : [],
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeSetupSession(raw: unknown): OpenClawCodeSetupSession | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeSetupSession>;
  if (
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  if (
    candidate.stage !== "drafting-blueprint" &&
    candidate.stage !== "awaiting-repo-choice" &&
    candidate.stage !== "awaiting-chat-pairing" &&
    candidate.stage !== "awaiting-github-device-auth" &&
    candidate.stage !== "github-authenticated" &&
    candidate.stage !== "repo-missing-blueprint-required" &&
    candidate.stage !== "repo-existing-blueprint-detected" &&
    candidate.stage !== "repo-nonstandard-context-detected" &&
    candidate.stage !== "repo-creation-pending" &&
    candidate.stage !== "bootstrap-ready" &&
    candidate.stage !== "bootstrap-complete"
  ) {
    return undefined;
  }
  const githubDeviceAuth =
    candidate.githubDeviceAuth && typeof candidate.githubDeviceAuth === "object"
      ? candidate.githubDeviceAuth
      : undefined;
  return {
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    projectMode:
      candidate.projectMode === "existing-repo" || candidate.projectMode === "new-project"
        ? candidate.projectMode
        : undefined,
    repoKey: typeof candidate.repoKey === "string" ? candidate.repoKey : undefined,
    pendingRepoName:
      typeof candidate.pendingRepoName === "string" ? candidate.pendingRepoName : undefined,
    stage: candidate.stage,
    blueprintDraft:
      candidate.blueprintDraft && typeof candidate.blueprintDraft === "object"
        ? {
            status:
              candidate.blueprintDraft.status === "draft" ||
              candidate.blueprintDraft.status === "agreed"
                ? candidate.blueprintDraft.status
                : undefined,
            agreedAt:
              typeof candidate.blueprintDraft.agreedAt === "string"
                ? candidate.blueprintDraft.agreedAt
                : undefined,
            repoNameSuggestions: Array.isArray(candidate.blueprintDraft.repoNameSuggestions)
              ? candidate.blueprintDraft.repoNameSuggestions.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            sourcePaths: Array.isArray(candidate.blueprintDraft.sourcePaths)
              ? candidate.blueprintDraft.sourcePaths.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            sections:
              candidate.blueprintDraft.sections &&
              typeof candidate.blueprintDraft.sections === "object"
                ? Object.fromEntries(
                    Object.entries(candidate.blueprintDraft.sections).filter(
                      (entry): entry is [string, string] => typeof entry[1] === "string",
                    ),
                  )
                : undefined,
          }
        : undefined,
    detectedBlueprint:
      candidate.detectedBlueprint && typeof candidate.detectedBlueprint === "object"
        ? {
            sourcePath:
              typeof candidate.detectedBlueprint.sourcePath === "string"
                ? candidate.detectedBlueprint.sourcePath
                : undefined,
            title:
              typeof candidate.detectedBlueprint.title === "string"
                ? candidate.detectedBlueprint.title
                : undefined,
            status:
              typeof candidate.detectedBlueprint.status === "string"
                ? candidate.detectedBlueprint.status
                : undefined,
            goalSummary:
              typeof candidate.detectedBlueprint.goalSummary === "string"
                ? candidate.detectedBlueprint.goalSummary
                : undefined,
            workstreamCandidateCount:
              typeof candidate.detectedBlueprint.workstreamCandidateCount === "number"
                ? candidate.detectedBlueprint.workstreamCandidateCount
                : undefined,
            openQuestionCount:
              typeof candidate.detectedBlueprint.openQuestionCount === "number"
                ? candidate.detectedBlueprint.openQuestionCount
                : undefined,
            humanGateCount:
              typeof candidate.detectedBlueprint.humanGateCount === "number"
                ? candidate.detectedBlueprint.humanGateCount
                : undefined,
          }
        : undefined,
    lastFailure:
      candidate.lastFailure &&
      typeof candidate.lastFailure === "object" &&
      typeof candidate.lastFailure.reason === "string" &&
      typeof candidate.lastFailure.occurredAt === "string" &&
      (candidate.lastFailure.step === "github-auth" ||
        candidate.lastFailure.step === "repo-create" ||
        candidate.lastFailure.step === "bootstrap" ||
        candidate.lastFailure.step === "blueprint-sync")
        ? {
            step: candidate.lastFailure.step,
            reason: candidate.lastFailure.reason,
            occurredAt: candidate.lastFailure.occurredAt,
          }
        : undefined,
    bootstrap:
      candidate.bootstrap && typeof candidate.bootstrap === "object"
        ? {
            completedAt:
              typeof candidate.bootstrap.completedAt === "string"
                ? candidate.bootstrap.completedAt
                : candidate.updatedAt,
            repoRoot:
              typeof candidate.bootstrap.repoRoot === "string"
                ? candidate.bootstrap.repoRoot
                : undefined,
            checkoutAction:
              typeof candidate.bootstrap.checkoutAction === "string"
                ? candidate.bootstrap.checkoutAction
                : undefined,
            blueprintPath:
              typeof candidate.bootstrap.blueprintPath === "string"
                ? candidate.bootstrap.blueprintPath
                : undefined,
            blueprintStatus:
              typeof candidate.bootstrap.blueprintStatus === "string"
                ? candidate.bootstrap.blueprintStatus
                : undefined,
            blueprintRevisionId:
              typeof candidate.bootstrap.blueprintRevisionId === "string"
                ? candidate.bootstrap.blueprintRevisionId
                : undefined,
            blueprintGoalSummary:
              typeof candidate.bootstrap.blueprintGoalSummary === "string"
                ? candidate.bootstrap.blueprintGoalSummary
                : undefined,
            workstreamCandidateCount:
              typeof candidate.bootstrap.workstreamCandidateCount === "number"
                ? candidate.bootstrap.workstreamCandidateCount
                : undefined,
            openQuestionCount:
              typeof candidate.bootstrap.openQuestionCount === "number"
                ? candidate.bootstrap.openQuestionCount
                : undefined,
            humanGateCount:
              typeof candidate.bootstrap.humanGateCount === "number"
                ? candidate.bootstrap.humanGateCount
                : undefined,
            clarificationQuestions: Array.isArray(candidate.bootstrap.clarificationQuestions)
              ? candidate.bootstrap.clarificationQuestions.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            clarificationSuggestions: Array.isArray(candidate.bootstrap.clarificationSuggestions)
              ? candidate.bootstrap.clarificationSuggestions.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            nextAction:
              typeof candidate.bootstrap.nextAction === "string"
                ? candidate.bootstrap.nextAction
                : undefined,
            cliRunCommand:
              typeof candidate.bootstrap.cliRunCommand === "string"
                ? candidate.bootstrap.cliRunCommand
                : candidate.bootstrap.cliRunCommand === null
                  ? null
                  : undefined,
            blueprintCommand:
              typeof candidate.bootstrap.blueprintCommand === "string"
                ? candidate.bootstrap.blueprintCommand
                : candidate.bootstrap.blueprintCommand === null
                  ? null
                  : undefined,
            blueprintClarifyCommand:
              typeof candidate.bootstrap.blueprintClarifyCommand === "string"
                ? candidate.bootstrap.blueprintClarifyCommand
                : candidate.bootstrap.blueprintClarifyCommand === null
                  ? null
                  : undefined,
            blueprintAgreeCommand:
              typeof candidate.bootstrap.blueprintAgreeCommand === "string"
                ? candidate.bootstrap.blueprintAgreeCommand
                : candidate.bootstrap.blueprintAgreeCommand === null
                  ? null
                  : undefined,
            blueprintDecomposeCommand:
              typeof candidate.bootstrap.blueprintDecomposeCommand === "string"
                ? candidate.bootstrap.blueprintDecomposeCommand
                : candidate.bootstrap.blueprintDecomposeCommand === null
                  ? null
                  : undefined,
            gatesCommand:
              typeof candidate.bootstrap.gatesCommand === "string"
                ? candidate.bootstrap.gatesCommand
                : candidate.bootstrap.gatesCommand === null
                  ? null
                  : undefined,
            gatewayRestartCommand:
              typeof candidate.bootstrap.gatewayRestartCommand === "string"
                ? candidate.bootstrap.gatewayRestartCommand
                : candidate.bootstrap.gatewayRestartCommand === null
                  ? null
                  : undefined,
            pluginActivationRepairCommand:
              typeof candidate.bootstrap.pluginActivationRepairCommand === "string"
                ? candidate.bootstrap.pluginActivationRepairCommand
                : candidate.bootstrap.pluginActivationRepairCommand === null
                  ? null
                  : undefined,
            chatSetupCommand:
              typeof candidate.bootstrap.chatSetupCommand === "string"
                ? candidate.bootstrap.chatSetupCommand
                : candidate.bootstrap.chatSetupCommand === null
                  ? null
                  : undefined,
            chatSetupStatusCommand:
              typeof candidate.bootstrap.chatSetupStatusCommand === "string"
                ? candidate.bootstrap.chatSetupStatusCommand
                : candidate.bootstrap.chatSetupStatusCommand === null
                  ? null
                  : undefined,
            chatBindCommand:
              typeof candidate.bootstrap.chatBindCommand === "string"
                ? candidate.bootstrap.chatBindCommand
                : candidate.bootstrap.chatBindCommand === null
                  ? null
                  : undefined,
            chatStartCommand:
              typeof candidate.bootstrap.chatStartCommand === "string"
                ? candidate.bootstrap.chatStartCommand
                : candidate.bootstrap.chatStartCommand === null
                  ? null
                  : undefined,
            webhookRetryCommand:
              typeof candidate.bootstrap.webhookRetryCommand === "string"
                ? candidate.bootstrap.webhookRetryCommand
                : candidate.bootstrap.webhookRetryCommand === null
                  ? null
                  : undefined,
            recommendedProofMode:
              candidate.bootstrap.recommendedProofMode === "cli-only" ||
              candidate.bootstrap.recommendedProofMode === "chatops"
                ? candidate.bootstrap.recommendedProofMode
                : undefined,
            reason:
              typeof candidate.bootstrap.reason === "string"
                ? candidate.bootstrap.reason
                : undefined,
            autoBindStatus:
              candidate.bootstrap.autoBindStatus === "bound" ||
              candidate.bootstrap.autoBindStatus === "already-bound" ||
              candidate.bootstrap.autoBindStatus === "existing-binding-kept"
                ? candidate.bootstrap.autoBindStatus
                : undefined,
            autoBindChannel:
              typeof candidate.bootstrap.autoBindChannel === "string"
                ? candidate.bootstrap.autoBindChannel
                : undefined,
            autoBindTarget:
              typeof candidate.bootstrap.autoBindTarget === "string"
                ? candidate.bootstrap.autoBindTarget
                : undefined,
            workItemCount:
              typeof candidate.bootstrap.workItemCount === "number"
                ? candidate.bootstrap.workItemCount
                : undefined,
            plannedWorkItemCount:
              typeof candidate.bootstrap.plannedWorkItemCount === "number"
                ? candidate.bootstrap.plannedWorkItemCount
                : undefined,
            readyForIssueProjection:
              typeof candidate.bootstrap.readyForIssueProjection === "boolean"
                ? candidate.bootstrap.readyForIssueProjection
                : undefined,
            blockedGateCount:
              typeof candidate.bootstrap.blockedGateCount === "number"
                ? candidate.bootstrap.blockedGateCount
                : undefined,
            needsHumanDecisionCount:
              typeof candidate.bootstrap.needsHumanDecisionCount === "number"
                ? candidate.bootstrap.needsHumanDecisionCount
                : undefined,
            pluginActivation:
              candidate.bootstrap.pluginActivation &&
              typeof candidate.bootstrap.pluginActivation === "object"
                ? {
                    ready:
                      typeof candidate.bootstrap.pluginActivation.ready === "boolean"
                        ? candidate.bootstrap.pluginActivation.ready
                        : undefined,
                    pluginsEnabled:
                      typeof candidate.bootstrap.pluginActivation.pluginsEnabled === "boolean"
                        ? candidate.bootstrap.pluginActivation.pluginsEnabled
                        : undefined,
                    allowlisted:
                      typeof candidate.bootstrap.pluginActivation.allowlisted === "boolean"
                        ? candidate.bootstrap.pluginActivation.allowlisted
                        : undefined,
                    entryEnabled:
                      typeof candidate.bootstrap.pluginActivation.entryEnabled === "boolean"
                        ? candidate.bootstrap.pluginActivation.entryEnabled
                        : undefined,
                  }
                : undefined,
            firstWorkItemTitle:
              typeof candidate.bootstrap.firstWorkItemTitle === "string"
                ? candidate.bootstrap.firstWorkItemTitle
                : undefined,
            nextSuggestedCommand:
              typeof candidate.bootstrap.nextSuggestedCommand === "string"
                ? candidate.bootstrap.nextSuggestedCommand
                : candidate.bootstrap.nextSuggestedCommand === null
                  ? null
                  : undefined,
            proofReadiness:
              candidate.bootstrap.proofReadiness &&
              typeof candidate.bootstrap.proofReadiness === "object"
                ? {
                    cliProofReady:
                      typeof candidate.bootstrap.proofReadiness.cliProofReady === "boolean"
                        ? candidate.bootstrap.proofReadiness.cliProofReady
                        : undefined,
                    chatProofReady:
                      typeof candidate.bootstrap.proofReadiness.chatProofReady === "boolean"
                        ? candidate.bootstrap.proofReadiness.chatProofReady
                        : undefined,
                    chatSetupRoutingReady:
                      typeof candidate.bootstrap.proofReadiness.chatSetupRoutingReady ===
                      "boolean"
                        ? candidate.bootstrap.proofReadiness.chatSetupRoutingReady
                        : undefined,
                    webhookReady:
                      typeof candidate.bootstrap.proofReadiness.webhookReady === "boolean"
                        ? candidate.bootstrap.proofReadiness.webhookReady
                        : undefined,
                    webhookUrlReady:
                      typeof candidate.bootstrap.proofReadiness.webhookUrlReady === "boolean"
                        ? candidate.bootstrap.proofReadiness.webhookUrlReady
                        : undefined,
                    needsChatBind:
                      typeof candidate.bootstrap.proofReadiness.needsChatBind === "boolean"
                        ? candidate.bootstrap.proofReadiness.needsChatBind
                        : undefined,
                    needsPublicWebhookUrl:
                      typeof candidate.bootstrap.proofReadiness.needsPublicWebhookUrl === "boolean"
                        ? candidate.bootstrap.proofReadiness.needsPublicWebhookUrl
                        : undefined,
                    recommendedProofMode:
                      candidate.bootstrap.proofReadiness.recommendedProofMode === "cli-only" ||
                      candidate.bootstrap.proofReadiness.recommendedProofMode === "chatops"
                        ? candidate.bootstrap.proofReadiness.recommendedProofMode
                        : undefined,
                  }
                : undefined,
          }
        : undefined,
    githubAuthSource:
      candidate.githubAuthSource === "GH_TOKEN" ||
      candidate.githubAuthSource === "GITHUB_TOKEN" ||
      candidate.githubAuthSource === "gh-auth-token"
        ? candidate.githubAuthSource
        : undefined,
    githubAuthLogin:
      typeof candidate.githubAuthLogin === "string" && candidate.githubAuthLogin.trim().length > 0
        ? candidate.githubAuthLogin.trim()
        : undefined,
    githubAuthName:
      typeof candidate.githubAuthName === "string" && candidate.githubAuthName.trim().length > 0
        ? candidate.githubAuthName.trim()
        : undefined,
    githubAuthEmail:
      typeof candidate.githubAuthEmail === "string" && candidate.githubAuthEmail.trim().length > 0
        ? candidate.githubAuthEmail.trim()
        : undefined,
    githubDeviceAuth:
      githubDeviceAuth &&
      typeof githubDeviceAuth.logPath === "string" &&
      typeof githubDeviceAuth.startedAt === "string"
        ? {
            pid: typeof githubDeviceAuth.pid === "number" ? githubDeviceAuth.pid : undefined,
            logPath: githubDeviceAuth.logPath,
            userCode:
              typeof githubDeviceAuth.userCode === "string" ? githubDeviceAuth.userCode : undefined,
            verificationUri:
              typeof githubDeviceAuth.verificationUri === "string"
                ? githubDeviceAuth.verificationUri
                : undefined,
            startedAt: githubDeviceAuth.startedAt,
            completedAt:
              typeof githubDeviceAuth.completedAt === "string"
                ? githubDeviceAuth.completedAt
                : undefined,
            failureReason:
              typeof githubDeviceAuth.failureReason === "string"
                ? githubDeviceAuth.failureReason
                : undefined,
            notificationState:
              githubDeviceAuth.notificationState === "authorized" ||
              githubDeviceAuth.notificationState === "failed"
                ? githubDeviceAuth.notificationState
                : undefined,
            notificationSentAt:
              typeof githubDeviceAuth.notificationSentAt === "string"
                ? githubDeviceAuth.notificationSentAt
                : undefined,
          }
        : undefined,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeManualTakeover(raw: unknown): OpenClawCodeManualTakeover | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeManualTakeover>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.worktreePath !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    runId: candidate.runId,
    stage: candidate.stage,
    branchName: typeof candidate.branchName === "string" ? candidate.branchName : undefined,
    worktreePath: candidate.worktreePath,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
    requestedAt: candidate.requestedAt,
  };
}

function normalizeDeferredRuntimeReroute(
  raw: unknown,
): OpenClawCodeDeferredRuntimeReroute | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeDeferredRuntimeReroute>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    requestedAt: candidate.requestedAt,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
    sourceRunId: typeof candidate.sourceRunId === "string" ? candidate.sourceRunId : undefined,
    sourceStage: typeof candidate.sourceStage === "string" ? candidate.sourceStage : undefined,
    requestedCoderAgentId:
      typeof candidate.requestedCoderAgentId === "string"
        ? candidate.requestedCoderAgentId
        : undefined,
    requestedVerifierAgentId:
      typeof candidate.requestedVerifierAgentId === "string"
        ? candidate.requestedVerifierAgentId
        : undefined,
  };
}

function normalizeStatusSnapshot(raw: unknown): OpenClawCodeIssueStatusSnapshot | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeIssueStatusSnapshot>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.owner !== "string" ||
    typeof candidate.repo !== "string" ||
    typeof candidate.issueNumber !== "number"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    status: candidate.status,
    stage: candidate.stage,
    runId: candidate.runId,
    updatedAt: candidate.updatedAt,
    owner: candidate.owner,
    repo: candidate.repo,
    issueNumber: candidate.issueNumber,
    branchName: typeof candidate.branchName === "string" ? candidate.branchName : undefined,
    worktreePath: typeof candidate.worktreePath === "string" ? candidate.worktreePath : undefined,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : undefined,
    pullRequestUrl:
      typeof candidate.pullRequestUrl === "string" ? candidate.pullRequestUrl : undefined,
    notifyChannel:
      typeof candidate.notifyChannel === "string" ? candidate.notifyChannel : undefined,
    notifyTarget: typeof candidate.notifyTarget === "string" ? candidate.notifyTarget : undefined,
    latestReviewDecision:
      candidate.latestReviewDecision === "approved" ||
      candidate.latestReviewDecision === "changes-requested"
        ? candidate.latestReviewDecision
        : undefined,
    latestReviewSubmittedAt:
      typeof candidate.latestReviewSubmittedAt === "string"
        ? candidate.latestReviewSubmittedAt
        : undefined,
    latestReviewSummary:
      typeof candidate.latestReviewSummary === "string" ? candidate.latestReviewSummary : undefined,
    latestReviewUrl:
      typeof candidate.latestReviewUrl === "string" ? candidate.latestReviewUrl : undefined,
    rerunReason: typeof candidate.rerunReason === "string" ? candidate.rerunReason : undefined,
    rerunRequestedAt:
      typeof candidate.rerunRequestedAt === "string" ? candidate.rerunRequestedAt : undefined,
    rerunPriorRunId:
      typeof candidate.rerunPriorRunId === "string" ? candidate.rerunPriorRunId : undefined,
    rerunPriorStage:
      typeof candidate.rerunPriorStage === "string" ? candidate.rerunPriorStage : undefined,
    rerunRequestedCoderAgentId:
      typeof candidate.rerunRequestedCoderAgentId === "string"
        ? candidate.rerunRequestedCoderAgentId
        : undefined,
    rerunRequestedVerifierAgentId:
      typeof candidate.rerunRequestedVerifierAgentId === "string"
        ? candidate.rerunRequestedVerifierAgentId
        : undefined,
    rerunManualTakeoverRequestedAt:
      typeof candidate.rerunManualTakeoverRequestedAt === "string"
        ? candidate.rerunManualTakeoverRequestedAt
        : undefined,
    rerunManualTakeoverActor:
      typeof candidate.rerunManualTakeoverActor === "string"
        ? candidate.rerunManualTakeoverActor
        : undefined,
    rerunManualTakeoverWorktreePath:
      typeof candidate.rerunManualTakeoverWorktreePath === "string"
        ? candidate.rerunManualTakeoverWorktreePath
        : undefined,
    rerunManualResumeNote:
      typeof candidate.rerunManualResumeNote === "string"
        ? candidate.rerunManualResumeNote
        : undefined,
    runtimeRoutingSummary:
      typeof candidate.runtimeRoutingSummary === "string"
        ? candidate.runtimeRoutingSummary
        : undefined,
    suitabilityDecision:
      candidate.suitabilityDecision === "auto-run" ||
      candidate.suitabilityDecision === "needs-human-review" ||
      candidate.suitabilityDecision === "escalate"
        ? candidate.suitabilityDecision
        : undefined,
    suitabilitySummary:
      typeof candidate.suitabilitySummary === "string" ? candidate.suitabilitySummary : undefined,
    suitabilityAllowlisted:
      typeof candidate.suitabilityAllowlisted === "boolean"
        ? candidate.suitabilityAllowlisted
        : undefined,
    suitabilityDenylisted:
      typeof candidate.suitabilityDenylisted === "boolean"
        ? candidate.suitabilityDenylisted
        : undefined,
    suitabilityOverrideApplied:
      typeof candidate.suitabilityOverrideApplied === "boolean"
        ? candidate.suitabilityOverrideApplied
        : undefined,
    suitabilityOverrideActor:
      typeof candidate.suitabilityOverrideActor === "string"
        ? candidate.suitabilityOverrideActor
        : undefined,
    suitabilityOverrideReason:
      typeof candidate.suitabilityOverrideReason === "string"
        ? candidate.suitabilityOverrideReason
        : undefined,
    handoffEntries: Array.isArray(candidate.handoffEntries)
      ? candidate.handoffEntries.flatMap((value) => {
          const normalized = normalizeWorkflowHandoffEntry(value);
          return normalized ? [normalized] : [];
        })
      : undefined,
    autoMergePolicyEligible:
      typeof candidate.autoMergePolicyEligible === "boolean"
        ? candidate.autoMergePolicyEligible
        : undefined,
    autoMergePolicyReason:
      typeof candidate.autoMergePolicyReason === "string"
        ? candidate.autoMergePolicyReason
        : undefined,
    autoMergeDisposition:
      candidate.autoMergeDisposition === "merged" ||
      candidate.autoMergeDisposition === "skipped" ||
      candidate.autoMergeDisposition === "failed"
        ? candidate.autoMergeDisposition
        : undefined,
    autoMergeDispositionReason:
      typeof candidate.autoMergeDispositionReason === "string"
        ? candidate.autoMergeDispositionReason
        : undefined,
    qualityGateStatus:
      candidate.qualityGateStatus === "pass" ||
      candidate.qualityGateStatus === "warn" ||
      candidate.qualityGateStatus === "fail" ||
      candidate.qualityGateStatus === "pending"
        ? candidate.qualityGateStatus
        : undefined,
    qualityGateSummary:
      typeof candidate.qualityGateSummary === "string" ? candidate.qualityGateSummary : undefined,
    qualityGateBlockingReasons: Array.isArray(candidate.qualityGateBlockingReasons)
      ? candidate.qualityGateBlockingReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    qualityGateWarningReasons: Array.isArray(candidate.qualityGateWarningReasons)
      ? candidate.qualityGateWarningReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    qualityGateFindingCount:
      typeof candidate.qualityGateFindingCount === "number"
        ? candidate.qualityGateFindingCount
        : undefined,
    qualityGateMissingCoverageCount:
      typeof candidate.qualityGateMissingCoverageCount === "number"
        ? candidate.qualityGateMissingCoverageCount
        : undefined,
    qualityGateFollowUpCount:
      typeof candidate.qualityGateFollowUpCount === "number"
        ? candidate.qualityGateFollowUpCount
        : undefined,
    preCodeDisciplineStatus:
      candidate.preCodeDisciplineStatus === "ready" ||
      candidate.preCodeDisciplineStatus === "warn" ||
      candidate.preCodeDisciplineStatus === "blocked" ||
      candidate.preCodeDisciplineStatus === "pending"
        ? candidate.preCodeDisciplineStatus
        : undefined,
    preCodeDisciplineSummary:
      typeof candidate.preCodeDisciplineSummary === "string"
        ? candidate.preCodeDisciplineSummary
        : undefined,
    preCodeDisciplineBlockingReasons: Array.isArray(candidate.preCodeDisciplineBlockingReasons)
      ? candidate.preCodeDisciplineBlockingReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    preCodeDisciplineWarningReasons: Array.isArray(candidate.preCodeDisciplineWarningReasons)
      ? candidate.preCodeDisciplineWarningReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    preCodeDisciplinePlanStatus:
      candidate.preCodeDisciplinePlanStatus === "not-required" ||
      candidate.preCodeDisciplinePlanStatus === "awaiting-approval" ||
      candidate.preCodeDisciplinePlanStatus === "approved" ||
      candidate.preCodeDisciplinePlanStatus === "missing"
        ? candidate.preCodeDisciplinePlanStatus
        : undefined,
    preCodeDisciplineExecutionSpecPresent:
      typeof candidate.preCodeDisciplineExecutionSpecPresent === "boolean"
        ? candidate.preCodeDisciplineExecutionSpecPresent
        : undefined,
    preCodeDisciplineTestIntentPresent:
      typeof candidate.preCodeDisciplineTestIntentPresent === "boolean"
        ? candidate.preCodeDisciplineTestIntentPresent
        : undefined,
    preCodeDisciplineTestIntentCount:
      typeof candidate.preCodeDisciplineTestIntentCount === "number"
        ? candidate.preCodeDisciplineTestIntentCount
        : undefined,
    preCodeDisciplinePlanApprovalRequired:
      typeof candidate.preCodeDisciplinePlanApprovalRequired === "boolean"
        ? candidate.preCodeDisciplinePlanApprovalRequired
        : undefined,
    preCodeDisciplinePlanEdited:
      typeof candidate.preCodeDisciplinePlanEdited === "boolean"
        ? candidate.preCodeDisciplinePlanEdited
        : undefined,
    preCodeDisciplineIsolatedWorktreePrepared:
      typeof candidate.preCodeDisciplineIsolatedWorktreePrepared === "boolean"
        ? candidate.preCodeDisciplineIsolatedWorktreePrepared
        : undefined,
    preCodeDisciplineModeSpecificContextsPresent:
      typeof candidate.preCodeDisciplineModeSpecificContextsPresent === "boolean"
        ? candidate.preCodeDisciplineModeSpecificContextsPresent
        : undefined,
    preCodeDisciplineFreshRoleExecutionPresent:
      typeof candidate.preCodeDisciplineFreshRoleExecutionPresent === "boolean"
        ? candidate.preCodeDisciplineFreshRoleExecutionPresent
        : undefined,
    loopHealthStatus:
      candidate.loopHealthStatus === "healthy" ||
      candidate.loopHealthStatus === "warn" ||
      candidate.loopHealthStatus === "blocked" ||
      candidate.loopHealthStatus === "pending"
        ? candidate.loopHealthStatus
        : undefined,
    loopHealthSummary:
      typeof candidate.loopHealthSummary === "string" ? candidate.loopHealthSummary : undefined,
    loopHealthBlockingReasons: Array.isArray(candidate.loopHealthBlockingReasons)
      ? candidate.loopHealthBlockingReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    loopHealthWarningReasons: Array.isArray(candidate.loopHealthWarningReasons)
      ? candidate.loopHealthWarningReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    loopHealthFailureSummary:
      typeof candidate.loopHealthFailureSummary === "string"
        ? candidate.loopHealthFailureSummary
        : undefined,
    loopHealthPromptFootprintChars:
      typeof candidate.loopHealthPromptFootprintChars === "number"
        ? candidate.loopHealthPromptFootprintChars
        : undefined,
    loopHealthBootstrapWarningShown:
      typeof candidate.loopHealthBootstrapWarningShown === "boolean"
        ? candidate.loopHealthBootstrapWarningShown
        : undefined,
    loopHealthInjectedWorkspaceFileCount:
      typeof candidate.loopHealthInjectedWorkspaceFileCount === "number"
        ? candidate.loopHealthInjectedWorkspaceFileCount
        : undefined,
    loopHealthLastCallUsageTotal:
      typeof candidate.loopHealthLastCallUsageTotal === "number"
        ? candidate.loopHealthLastCallUsageTotal
        : undefined,
    failureDiagnostics: normalizeWorkflowFailureDiagnostics(candidate.failureDiagnostics),
    providerFailureCount:
      typeof candidate.providerFailureCount === "number"
        ? candidate.providerFailureCount
        : undefined,
    lastProviderFailureAt:
      typeof candidate.lastProviderFailureAt === "string"
        ? candidate.lastProviderFailureAt
        : undefined,
    providerPauseUntil:
      typeof candidate.providerPauseUntil === "string" ? candidate.providerPauseUntil : undefined,
    providerPauseReason:
      typeof candidate.providerPauseReason === "string" ? candidate.providerPauseReason : undefined,
    lastNotificationChannel:
      typeof candidate.lastNotificationChannel === "string"
        ? candidate.lastNotificationChannel
        : undefined,
    lastNotificationTarget:
      typeof candidate.lastNotificationTarget === "string"
        ? candidate.lastNotificationTarget
        : undefined,
    lastNotificationAt:
      typeof candidate.lastNotificationAt === "string" ? candidate.lastNotificationAt : undefined,
    lastNotificationStatus:
      candidate.lastNotificationStatus === "sent" || candidate.lastNotificationStatus === "failed"
        ? candidate.lastNotificationStatus
        : undefined,
    lastNotificationError:
      typeof candidate.lastNotificationError === "string"
        ? candidate.lastNotificationError
        : undefined,
  };
}

function normalizeWorkflowFailureDiagnostics(raw: unknown): WorkflowFailureDiagnostics | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<WorkflowFailureDiagnostics>;
  const normalized: WorkflowFailureDiagnostics = {
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    systemPromptChars:
      typeof candidate.systemPromptChars === "number" ? candidate.systemPromptChars : undefined,
    skillsPromptChars:
      typeof candidate.skillsPromptChars === "number" ? candidate.skillsPromptChars : undefined,
    toolSchemaChars:
      typeof candidate.toolSchemaChars === "number" ? candidate.toolSchemaChars : undefined,
    toolCount: typeof candidate.toolCount === "number" ? candidate.toolCount : undefined,
    skillCount: typeof candidate.skillCount === "number" ? candidate.skillCount : undefined,
    injectedWorkspaceFileCount:
      typeof candidate.injectedWorkspaceFileCount === "number"
        ? candidate.injectedWorkspaceFileCount
        : undefined,
    bootstrapWarningShown:
      typeof candidate.bootstrapWarningShown === "boolean"
        ? candidate.bootstrapWarningShown
        : undefined,
    lastCallUsageTotal:
      typeof candidate.lastCallUsageTotal === "number" ? candidate.lastCallUsageTotal : undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeRepoNotificationBinding(
  raw: unknown,
): OpenClawCodeRepoNotificationBinding | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeRepoNotificationBinding>;
  if (
    typeof candidate.repoKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    repoKey: candidate.repoKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeGitHubDeliveryRecord(raw: unknown): OpenClawCodeGitHubDeliveryRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeGitHubDeliveryRecord>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.eventName !== "string" ||
    typeof candidate.action !== "string" ||
    typeof candidate.accepted !== "boolean" ||
    typeof candidate.reason !== "string" ||
    typeof candidate.receivedAt !== "string"
  ) {
    return undefined;
  }
  return {
    deliveryId: candidate.deliveryId,
    eventName: candidate.eventName,
    action: candidate.action,
    accepted: candidate.accepted,
    reason: candidate.reason,
    receivedAt: candidate.receivedAt,
    issueKey: typeof candidate.issueKey === "string" ? candidate.issueKey : undefined,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : undefined,
  };
}

function normalizeTransientProviderFailureRecord(
  raw: unknown,
): OpenClawCodeTransientProviderFailureRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeTransientProviderFailureRecord>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.failedAt !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    runId: candidate.runId,
    failedAt: candidate.failedAt,
    summary: candidate.summary,
  };
}

function normalizeProviderPause(raw: unknown): OpenClawCodeProviderPause | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeProviderPause>;
  if (
    typeof candidate.until !== "string" ||
    typeof candidate.triggeredAt !== "string" ||
    typeof candidate.lastFailureAt !== "string" ||
    typeof candidate.failureCount !== "number" ||
    typeof candidate.reason !== "string"
  ) {
    return undefined;
  }
  return {
    until: candidate.until,
    triggeredAt: candidate.triggeredAt,
    lastFailureAt: candidate.lastFailureAt,
    failureCount: candidate.failureCount,
    reason: candidate.reason,
  };
}

function normalizePendingApproval(raw: unknown): OpenClawCodePendingApproval | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodePendingApproval>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    approvalKind:
      candidate.approvalKind === "manual" || candidate.approvalKind === "execution-start-gated"
        ? candidate.approvalKind
        : undefined,
  };
}

function normalizeWorkflowHandoffEntry(raw: unknown): WorkflowHandoffEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<WorkflowHandoffEntry>;
  if (
    typeof candidate.kind !== "string" ||
    typeof candidate.recordedAt !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return undefined;
  }
  if (
    candidate.kind !== "stage-gate-decision" &&
    candidate.kind !== "rerun-request" &&
    candidate.kind !== "runtime-steering" &&
    candidate.kind !== "runtime-reroute" &&
    candidate.kind !== "manual-takeover" &&
    candidate.kind !== "manual-resume" &&
    candidate.kind !== "suitability-override"
  ) {
    return undefined;
  }
  return {
    kind: candidate.kind,
    recordedAt: candidate.recordedAt,
    summary: candidate.summary,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    gateId: typeof candidate.gateId === "string" ? candidate.gateId : undefined,
    decision: typeof candidate.decision === "string" ? candidate.decision : undefined,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
    priorRunId: typeof candidate.priorRunId === "string" ? candidate.priorRunId : undefined,
    priorStage: typeof candidate.priorStage === "string" ? candidate.priorStage : undefined,
    reviewDecision:
      candidate.reviewDecision === "approved" || candidate.reviewDecision === "changes-requested"
        ? candidate.reviewDecision
        : undefined,
    reviewSubmittedAt:
      typeof candidate.reviewSubmittedAt === "string" ? candidate.reviewSubmittedAt : undefined,
    requestedCoderAgentId:
      typeof candidate.requestedCoderAgentId === "string"
        ? candidate.requestedCoderAgentId
        : undefined,
    requestedVerifierAgentId:
      typeof candidate.requestedVerifierAgentId === "string"
        ? candidate.requestedVerifierAgentId
        : undefined,
    worktreePath: typeof candidate.worktreePath === "string" ? candidate.worktreePath : undefined,
  };
}

function buildRuntimeRoutingSummary(run: WorkflowRun): string | undefined {
  const selections = run.runtimeRouting?.selections;
  if (!selections || selections.length === 0) {
    return undefined;
  }

  return selections
    .map((selection) =>
      [
        `${selection.roleId}=${selection.appliedAgentId ?? "runner-default"}`,
        selection.adapterId ? `adapter=${selection.adapterId}` : undefined,
        `source=${selection.agentSource}`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join(" || ");
}

function buildStatusSnapshot(params: {
  run: WorkflowRun;
  status: string;
  notifyChannel?: string;
  notifyTarget?: string;
  notifiedAt?: string;
}): OpenClawCodeIssueStatusSnapshot {
  const autoMergePolicy = resolveAutoMergePolicy(params.run);
  const autoMergeDisposition = resolveAutoMergeDisposition(params.run);
  const qualityGate = deriveWorkflowQualityGate(params.run);
  const preCodeDiscipline = deriveWorkflowPreCodeDiscipline(params.run);
  const loopHealth = deriveWorkflowLoopHealth(params.run);
  return {
    issueKey: `${params.run.issue.owner}/${params.run.issue.repo}#${params.run.issue.number}`,
    status: params.status,
    stage: params.run.stage,
    runId: params.run.id,
    updatedAt: params.run.updatedAt,
    owner: params.run.issue.owner,
    repo: params.run.issue.repo,
    issueNumber: params.run.issue.number,
    branchName: params.run.workspace?.branchName ?? params.run.buildResult?.branchName,
    worktreePath: params.run.workspace?.worktreePath,
    pullRequestNumber: params.run.draftPullRequest?.number,
    pullRequestUrl: params.run.draftPullRequest?.url,
    notifyChannel: params.notifyChannel,
    notifyTarget: params.notifyTarget,
    latestReviewDecision: params.run.rerunContext?.reviewDecision,
    latestReviewSubmittedAt: params.run.rerunContext?.reviewSubmittedAt,
    latestReviewSummary: params.run.rerunContext?.reviewSummary,
    latestReviewUrl: params.run.rerunContext?.reviewUrl,
    rerunReason: params.run.rerunContext?.reason,
    rerunRequestedAt: params.run.rerunContext?.requestedAt,
    rerunPriorRunId: params.run.rerunContext?.priorRunId,
    rerunPriorStage: params.run.rerunContext?.priorStage,
    rerunRequestedCoderAgentId: params.run.rerunContext?.requestedCoderAgentId,
    rerunRequestedVerifierAgentId: params.run.rerunContext?.requestedVerifierAgentId,
    rerunManualTakeoverRequestedAt: params.run.rerunContext?.manualTakeoverRequestedAt,
    rerunManualTakeoverActor: params.run.rerunContext?.manualTakeoverActor,
    rerunManualTakeoverWorktreePath: params.run.rerunContext?.manualTakeoverWorktreePath,
    rerunManualResumeNote: params.run.rerunContext?.manualResumeNote,
    runtimeRoutingSummary: buildRuntimeRoutingSummary(params.run),
    suitabilityDecision: params.run.suitability?.decision,
    suitabilitySummary: params.run.suitability?.summary,
    suitabilityAllowlisted: params.run.suitability?.allowlisted,
    suitabilityDenylisted: params.run.suitability?.denylisted,
    suitabilityOverrideApplied: params.run.suitability?.overrideApplied,
    suitabilityOverrideActor: params.run.suitability?.overrideActor,
    suitabilityOverrideReason: params.run.suitability?.overrideReason,
    handoffEntries:
      params.run.handoffs?.entries.length && params.run.handoffs.entries.length > 0
        ? params.run.handoffs.entries
        : undefined,
    autoMergePolicyEligible: autoMergePolicy.autoMergePolicyEligible,
    autoMergePolicyReason: autoMergePolicy.autoMergePolicyReason,
    autoMergeDisposition: autoMergeDisposition.autoMergeDisposition ?? undefined,
    autoMergeDispositionReason: autoMergeDisposition.autoMergeDispositionReason ?? undefined,
    qualityGateStatus: qualityGate.status,
    qualityGateSummary: qualityGate.summary,
    qualityGateBlockingReasons: qualityGate.blockingReasons,
    qualityGateWarningReasons: qualityGate.warningReasons,
    qualityGateFindingCount: qualityGate.findingCount,
    qualityGateMissingCoverageCount: qualityGate.missingCoverageCount,
    qualityGateFollowUpCount: qualityGate.followUpCount,
    preCodeDisciplineStatus: preCodeDiscipline.status,
    preCodeDisciplineSummary: preCodeDiscipline.summary,
    preCodeDisciplineBlockingReasons: preCodeDiscipline.blockingReasons,
    preCodeDisciplineWarningReasons: preCodeDiscipline.warningReasons,
    preCodeDisciplinePlanStatus: preCodeDiscipline.planStatus,
    preCodeDisciplineExecutionSpecPresent: preCodeDiscipline.executionSpecPresent,
    preCodeDisciplineTestIntentPresent: preCodeDiscipline.testIntentPresent,
    preCodeDisciplineTestIntentCount: preCodeDiscipline.testIntentCount,
    preCodeDisciplinePlanApprovalRequired: preCodeDiscipline.planApprovalRequired,
    preCodeDisciplinePlanEdited: preCodeDiscipline.planEdited,
    preCodeDisciplineIsolatedWorktreePrepared: preCodeDiscipline.isolatedWorktreePrepared,
    preCodeDisciplineModeSpecificContextsPresent: preCodeDiscipline.modeSpecificContextsPresent,
    preCodeDisciplineFreshRoleExecutionPresent: preCodeDiscipline.freshRoleExecutionPresent,
    loopHealthStatus: loopHealth.status,
    loopHealthSummary: loopHealth.summary,
    loopHealthBlockingReasons: loopHealth.blockingReasons,
    loopHealthWarningReasons: loopHealth.warningReasons,
    loopHealthFailureSummary: loopHealth.failureSummary ?? undefined,
    loopHealthPromptFootprintChars: loopHealth.promptFootprintChars ?? undefined,
    loopHealthBootstrapWarningShown: loopHealth.bootstrapWarningShown,
    loopHealthInjectedWorkspaceFileCount: loopHealth.injectedWorkspaceFileCount,
    loopHealthLastCallUsageTotal: loopHealth.lastCallUsageTotal ?? undefined,
    failureDiagnostics: params.run.failureDiagnostics,
    lastNotificationChannel: params.notifyChannel,
    lastNotificationTarget: params.notifyTarget,
    lastNotificationAt: params.notifiedAt,
    lastNotificationStatus: params.notifiedAt ? "sent" : undefined,
  };
}

function isTransientProviderFailureStatus(status: string): boolean {
  return PROVIDER_INTERNAL_ERROR_PATTERN.test(status);
}

function pruneRecentProviderFailures(
  entries: OpenClawCodeTransientProviderFailureRecord[],
  referenceAt: string,
): OpenClawCodeTransientProviderFailureRecord[] {
  const cutoff = new Date(referenceAt).getTime() - PROVIDER_FAILURE_WINDOW_MS;
  return entries.filter((entry) => new Date(entry.failedAt).getTime() >= cutoff);
}

function buildProviderPause(
  failures: OpenClawCodeTransientProviderFailureRecord[],
): OpenClawCodeProviderPause | undefined {
  if (failures.length < PROVIDER_FAILURE_THRESHOLD) {
    return undefined;
  }
  const lastFailureAt = failures[failures.length - 1]?.failedAt;
  if (!lastFailureAt) {
    return undefined;
  }
  return {
    until: new Date(new Date(lastFailureAt).getTime() + PROVIDER_PAUSE_MS).toISOString(),
    triggeredAt: lastFailureAt,
    lastFailureAt,
    failureCount: failures.length,
    reason: [
      `Paused after ${failures.length} recent provider-side transient failures.`,
      "Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
    ].join(" "),
  };
}

function applyProviderFailureStateFromSnapshot(
  state: OpenClawCodeQueueState,
  snapshot: OpenClawCodeIssueStatusSnapshot,
): void {
  snapshot.providerFailureCount = undefined;
  snapshot.lastProviderFailureAt = undefined;
  snapshot.providerPauseUntil = undefined;
  snapshot.providerPauseReason = undefined;

  if (snapshot.stage !== "failed") {
    state.recentProviderFailures = [];
    state.providerPause = undefined;
    return;
  }

  const recent = pruneRecentProviderFailures(state.recentProviderFailures, snapshot.updatedAt);
  if (!isTransientProviderFailureStatus(snapshot.status)) {
    state.recentProviderFailures = recent;
    state.providerPause =
      state.providerPause && state.providerPause.until > snapshot.updatedAt
        ? state.providerPause
        : undefined;
    return;
  }

  recent.push({
    issueKey: snapshot.issueKey,
    runId: snapshot.runId,
    failedAt: snapshot.updatedAt,
    summary: snapshot.status,
  });
  state.recentProviderFailures = recent;
  const pause = buildProviderPause(recent);
  state.providerPause = pause;
  snapshot.providerFailureCount = recent.length;
  snapshot.lastProviderFailureAt = snapshot.updatedAt;
  snapshot.providerPauseUntil = pause?.until;
  snapshot.providerPauseReason = pause?.reason;
}

function normalizeState(raw: unknown): OpenClawCodeQueueState {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultState();
  }
  const candidate = raw as Partial<OpenClawCodeQueueState>;
  const statusSnapshotsByIssue = Object.fromEntries(
    Object.entries(
      candidate.statusSnapshotsByIssue && typeof candidate.statusSnapshotsByIssue === "object"
        ? candidate.statusSnapshotsByIssue
        : {},
    ).flatMap(([issueKey, value]) => {
      const snapshot = normalizeStatusSnapshot(value);
      return snapshot ? [[issueKey, snapshot]] : [];
    }),
  );
  const repoBindingsByRepo = Object.fromEntries(
    Object.entries(
      candidate.repoBindingsByRepo && typeof candidate.repoBindingsByRepo === "object"
        ? candidate.repoBindingsByRepo
        : {},
    ).flatMap(([repoKey, value]) => {
      const binding = normalizeRepoNotificationBinding(value);
      return binding ? [[repoKey, binding]] : [];
    }),
  );
  const githubDeliveriesById = Object.fromEntries(
    Object.entries(
      candidate.githubDeliveriesById && typeof candidate.githubDeliveriesById === "object"
        ? candidate.githubDeliveriesById
        : {},
    ).flatMap(([deliveryId, value]) => {
      const record = normalizeGitHubDeliveryRecord(value);
      return record ? [[deliveryId, record]] : [];
    }),
  );
  const recentProviderFailures = Array.isArray(candidate.recentProviderFailures)
    ? candidate.recentProviderFailures.flatMap((value) => {
        const record = normalizeTransientProviderFailureRecord(value);
        return record ? [record] : [];
      })
    : [];
  return {
    version: 1,
    pendingApprovals: Array.isArray(candidate.pendingApprovals)
      ? candidate.pendingApprovals.flatMap((value) => {
          const pending = normalizePendingApproval(value);
          return pending ? [pending] : [];
        })
      : [],
    pendingIntakeDrafts: Array.isArray(candidate.pendingIntakeDrafts)
      ? candidate.pendingIntakeDrafts.flatMap((value) => {
          const draft = normalizePendingIntakeDraft(value);
          return draft ? [draft] : [];
        })
      : [],
    setupSessions: Array.isArray(candidate.setupSessions)
      ? candidate.setupSessions.flatMap((value) => {
          const session = normalizeSetupSession(value);
          return session ? [session] : [];
        })
      : [],
    manualTakeovers: Array.isArray(candidate.manualTakeovers)
      ? candidate.manualTakeovers.flatMap((value) => {
          const takeover = normalizeManualTakeover(value);
          return takeover ? [takeover] : [];
        })
      : [],
    deferredRuntimeReroutes: Array.isArray(candidate.deferredRuntimeReroutes)
      ? candidate.deferredRuntimeReroutes.flatMap((value) => {
          const record = normalizeDeferredRuntimeReroute(value);
          return record ? [record] : [];
        })
      : [],
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    currentRun:
      candidate.currentRun && typeof candidate.currentRun === "object"
        ? candidate.currentRun
        : undefined,
    statusByIssue:
      candidate.statusByIssue && typeof candidate.statusByIssue === "object"
        ? candidate.statusByIssue
        : {},
    statusSnapshotsByIssue,
    repoBindingsByRepo,
    githubDeliveriesById,
    recentProviderFailures,
    providerPause: normalizeProviderPause(candidate.providerPause),
  };
}

export class OpenClawCodeChatopsStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly statePath: string) {}

  static fromStateDir(stateDir: string): OpenClawCodeChatopsStore {
    return new OpenClawCodeChatopsStore(
      path.join(stateDir, "plugins", "openclawcode", "chatops-state.json"),
    );
  }

  private async loadState(): Promise<OpenClawCodeQueueState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cloneDefaultState();
      }
      throw error;
    }
  }

  private async flushMutations(): Promise<void> {
    await this.mutationQueue;
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.catch(() => undefined);
    const next = pending.then(operation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  private async mutateState<T>(
    mutator: (state: OpenClawCodeQueueState) => Promise<T> | T,
  ): Promise<T> {
    return await this.withMutationLock(async () => {
      const state = await this.loadState();
      const result = await mutator(state);
      await this.saveState(state);
      return result;
    });
  }

  private async saveState(state: OpenClawCodeQueueState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async getStatus(issueKey: string): Promise<string | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusByIssue[issueKey];
  }

  async getPendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.find((entry) => entry.issueKey === issueKey);
  }

  async getPendingIntakeDraft(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodePendingIntakeDraft | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingIntakeDrafts.find(
      (entry) =>
        entry.repoKey === params.repoKey &&
        entry.notifyChannel === params.notifyChannel &&
        entry.notifyTarget === params.notifyTarget,
    );
  }

  async getSetupSession(params: {
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodeSetupSession | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.setupSessions.find(
      (entry) =>
        entry.notifyChannel === params.notifyChannel && entry.notifyTarget === params.notifyTarget,
    );
  }

  async listSetupSessions(): Promise<OpenClawCodeSetupSession[]> {
    await this.flushMutations();
    const state = await this.loadState();
    return [...state.setupSessions];
  }

  async getManualTakeover(issueKey: string): Promise<OpenClawCodeManualTakeover | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.manualTakeovers.find((entry) => entry.issueKey === issueKey);
  }

  async getDeferredRuntimeReroute(
    issueKey: string,
  ): Promise<OpenClawCodeDeferredRuntimeReroute | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.deferredRuntimeReroutes.find((entry) => entry.issueKey === issueKey);
  }

  async getStatusSnapshot(issueKey: string): Promise<OpenClawCodeIssueStatusSnapshot | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusSnapshotsByIssue[issueKey];
  }

  async findStatusSnapshotByPullRequest(params: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
  }): Promise<OpenClawCodeIssueStatusSnapshot | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    const owner = params.owner.toLowerCase();
    const repo = params.repo.toLowerCase();
    return Object.values(state.statusSnapshotsByIssue).find(
      (snapshot) =>
        snapshot.pullRequestNumber === params.pullRequestNumber &&
        snapshot.owner.toLowerCase() === owner &&
        snapshot.repo.toLowerCase() === repo,
    );
  }

  async getRepoBinding(repoKey: string): Promise<OpenClawCodeRepoNotificationBinding | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.repoBindingsByRepo[repoKey];
  }

  async listRepoBindings(): Promise<OpenClawCodeRepoNotificationBinding[]> {
    await this.flushMutations();
    const state = await this.loadState();
    return Object.values(state.repoBindingsByRepo);
  }

  async getGitHubDelivery(
    deliveryId: string,
  ): Promise<OpenClawCodeGitHubDeliveryRecord | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.githubDeliveriesById[deliveryId];
  }

  async setStatus(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[issueKey] = status;
      const currentSnapshot = state.statusSnapshotsByIssue[issueKey];
      if (currentSnapshot) {
        state.statusSnapshotsByIssue[issueKey] = {
          ...currentSnapshot,
          status,
        };
      }
    });
  }

  async recordWorkflowRunStatus(
    run: WorkflowRun,
    status: string,
    notify?: {
      notifyChannel?: string;
      notifyTarget?: string;
    },
  ): Promise<void> {
    await this.mutateState((state) => {
      const snapshot = buildStatusSnapshot({
        run,
        status,
        notifyChannel: notify?.notifyChannel,
        notifyTarget: notify?.notifyTarget,
        notifiedAt:
          notify?.notifyChannel && notify?.notifyTarget ? new Date().toISOString() : undefined,
      });
      state.statusByIssue[snapshot.issueKey] = status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
      applyProviderFailureStateFromSnapshot(state, snapshot);
    });
  }

  async setStatusSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[snapshot.issueKey] = snapshot.status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
    });
  }

  async recordPrecheckedEscalation(snapshot: OpenClawCodeIssueStatusSnapshot): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === snapshot.issueKey) ||
        state.currentRun?.issueKey === snapshot.issueKey ||
        state.queue.some((entry) => entry.issueKey === snapshot.issueKey)
      ) {
        return false;
      }
      state.statusByIssue[snapshot.issueKey] = snapshot.status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
      return true;
    });
  }

  async recordSnapshotNotification(params: {
    issueKey: string;
    notifyChannel: string;
    notifyTarget: string;
    notifiedAt: string;
    status: "sent" | "failed";
    error?: string;
  }): Promise<void> {
    await this.mutateState((state) => {
      const snapshot = state.statusSnapshotsByIssue[params.issueKey];
      if (!snapshot) {
        return;
      }
      state.statusSnapshotsByIssue[params.issueKey] = {
        ...snapshot,
        notifyChannel: params.notifyChannel,
        notifyTarget: params.notifyTarget,
        lastNotificationChannel: params.notifyChannel,
        lastNotificationTarget: params.notifyTarget,
        lastNotificationAt: params.notifiedAt,
        lastNotificationStatus: params.status,
        lastNotificationError: params.status === "failed" ? params.error : undefined,
      };
    });
  }

  async setRepoBinding(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodeRepoNotificationBinding> {
    return await this.mutateState((state) => {
      const binding: OpenClawCodeRepoNotificationBinding = {
        repoKey: params.repoKey,
        notifyChannel: params.notifyChannel,
        notifyTarget: params.notifyTarget,
        updatedAt: new Date().toISOString(),
      };
      state.repoBindingsByRepo[params.repoKey] = binding;
      return binding;
    });
  }

  async removeRepoBinding(repoKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      if (!state.repoBindingsByRepo[repoKey]) {
        return false;
      }
      delete state.repoBindingsByRepo[repoKey];
      return true;
    });
  }

  async recordGitHubDelivery(
    record: OpenClawCodeGitHubDeliveryRecord,
  ): Promise<OpenClawCodeGitHubDeliveryRecord> {
    return await this.mutateState((state) => {
      const existing = state.githubDeliveriesById[record.deliveryId];
      if (existing) {
        return existing;
      }
      state.githubDeliveriesById[record.deliveryId] = record;
      const deliveryIds = Object.keys(state.githubDeliveriesById);
      const overflow = deliveryIds.length - MAX_GITHUB_DELIVERY_RECORDS;
      if (overflow > 0) {
        for (const deliveryId of deliveryIds.slice(0, overflow)) {
          delete state.githubDeliveriesById[deliveryId];
        }
      }
      return record;
    });
  }

  async reconcileStatuses(statuses: Record<string, string>): Promise<void> {
    await this.mutateState((state) => {
      for (const [issueKey, status] of Object.entries(statuses)) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === issueKey) ||
          state.currentRun?.issueKey === issueKey ||
          state.queue.some((entry) => entry.issueKey === issueKey);
        if (isActive) {
          continue;
        }
        state.statusByIssue[issueKey] = status;
      }
    });
  }

  async reconcileWorkflowRunStatuses(
    records: Array<{
      issueKey: string;
      status: string;
      run: WorkflowRun;
    }>,
  ): Promise<void> {
    await this.mutateState((state) => {
      const orderedRecords = [...records].toSorted((left, right) =>
        left.run.updatedAt.localeCompare(right.run.updatedAt),
      );
      for (const record of orderedRecords) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === record.issueKey) ||
          state.currentRun?.issueKey === record.issueKey ||
          state.queue.some((entry) => entry.issueKey === record.issueKey);
        if (isActive) {
          continue;
        }
        const currentSnapshot = state.statusSnapshotsByIssue[record.issueKey];
        if (currentSnapshot && currentSnapshot.updatedAt > record.run.updatedAt) {
          continue;
        }
        state.statusByIssue[record.issueKey] = record.status;
        const snapshot = buildStatusSnapshot(record);
        state.statusSnapshotsByIssue[record.issueKey] = snapshot;
        applyProviderFailureStateFromSnapshot(state, snapshot);
      }
    });
  }

  async addPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === pending.issueKey) ||
        state.currentRun?.issueKey === pending.issueKey ||
        state.queue.some((entry) => entry.issueKey === pending.issueKey)
      ) {
        return false;
      }
      state.pendingApprovals.push(pending);
      state.statusByIssue[pending.issueKey] = status;
      return true;
    });
  }

  async upsertPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<"added" | "updated" | "already-tracked"> {
    return await this.mutateState((state) => {
      if (
        state.currentRun?.issueKey === pending.issueKey ||
        state.queue.some((entry) => entry.issueKey === pending.issueKey)
      ) {
        return "already-tracked";
      }
      const existingIndex = state.pendingApprovals.findIndex(
        (entry) => entry.issueKey === pending.issueKey,
      );
      if (existingIndex >= 0) {
        const existing = state.pendingApprovals[existingIndex];
        state.pendingApprovals[existingIndex] = {
          ...existing,
          ...pending,
          approvalKind: pending.approvalKind ?? existing?.approvalKind,
        };
        state.statusByIssue[pending.issueKey] = status;
        return "updated";
      }
      state.pendingApprovals.push(pending);
      state.statusByIssue[pending.issueKey] = status;
      return "added";
    });
  }

  async upsertPendingIntakeDraft(
    draft: OpenClawCodePendingIntakeDraft,
  ): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.pendingIntakeDrafts.findIndex(
        (entry) =>
          entry.repoKey === draft.repoKey &&
          entry.notifyChannel === draft.notifyChannel &&
          entry.notifyTarget === draft.notifyTarget,
      );
      if (existingIndex >= 0) {
        const existing = state.pendingIntakeDrafts[existingIndex];
        state.pendingIntakeDrafts[existingIndex] = {
          ...existing,
          ...draft,
          createdAt: existing?.createdAt ?? draft.createdAt,
        };
        return "updated";
      }
      state.pendingIntakeDrafts.push(draft);
      return "added";
    });
  }

  async upsertSetupSession(session: OpenClawCodeSetupSession): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.setupSessions.findIndex(
        (entry) =>
          entry.notifyChannel === session.notifyChannel &&
          entry.notifyTarget === session.notifyTarget,
      );
      if (existingIndex >= 0) {
        const existing = state.setupSessions[existingIndex];
        state.setupSessions[existingIndex] = {
          ...existing,
          ...session,
          createdAt: existing?.createdAt ?? session.createdAt,
        };
        return "updated";
      }
      state.setupSessions.push(session);
      return "added";
    });
  }

  async removePendingIntakeDraft(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.pendingIntakeDrafts.findIndex(
        (entry) =>
          entry.repoKey === params.repoKey &&
          entry.notifyChannel === params.notifyChannel &&
          entry.notifyTarget === params.notifyTarget,
      );
      if (index < 0) {
        return false;
      }
      state.pendingIntakeDrafts.splice(index, 1);
      return true;
    });
  }

  async removeSetupSession(params: {
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.setupSessions.findIndex(
        (entry) =>
          entry.notifyChannel === params.notifyChannel &&
          entry.notifyTarget === params.notifyTarget,
      );
      if (index < 0) {
        return false;
      }
      state.setupSessions.splice(index, 1);
      return true;
    });
  }

  async upsertManualTakeover(takeover: OpenClawCodeManualTakeover): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.manualTakeovers.findIndex(
        (entry) => entry.issueKey === takeover.issueKey,
      );
      if (existingIndex >= 0) {
        state.manualTakeovers[existingIndex] = {
          ...state.manualTakeovers[existingIndex],
          ...takeover,
        };
        return "updated";
      }
      state.manualTakeovers.push(takeover);
      return "added";
    });
  }

  async removeManualTakeover(issueKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.manualTakeovers.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.manualTakeovers.splice(index, 1);
      return true;
    });
  }

  async upsertDeferredRuntimeReroute(
    record: OpenClawCodeDeferredRuntimeReroute,
  ): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.deferredRuntimeReroutes.findIndex(
        (entry) => entry.issueKey === record.issueKey,
      );
      if (existingIndex >= 0) {
        const existing = state.deferredRuntimeReroutes[existingIndex];
        state.deferredRuntimeReroutes[existingIndex] = {
          ...existing,
          ...record,
          requestedCoderAgentId: record.requestedCoderAgentId ?? existing.requestedCoderAgentId,
          requestedVerifierAgentId:
            record.requestedVerifierAgentId ?? existing.requestedVerifierAgentId,
        };
        return "updated";
      }
      state.deferredRuntimeReroutes.push(record);
      return "added";
    });
  }

  async removeDeferredRuntimeReroute(issueKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.deferredRuntimeReroutes.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.deferredRuntimeReroutes.splice(index, 1);
      return true;
    });
  }

  async consumePendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return undefined;
      }
      const [pending] = state.pendingApprovals.splice(index, 1);
      return pending;
    });
  }

  async removePendingApproval(
    issueKey: string,
    status = "Skipped before execution.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.pendingApprovals.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async isPendingApproval(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.some((entry) => entry.issueKey === issueKey);
  }

  async isQueuedOrRunning(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return (
      state.currentRun?.issueKey === issueKey ||
      state.queue.some((entry) => entry.issueKey === issueKey)
    );
  }

  async enqueue(run: OpenClawCodeQueuedRun, status = "Queued."): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === run.issueKey) ||
        state.currentRun?.issueKey === run.issueKey ||
        state.queue.some((entry) => entry.issueKey === run.issueKey)
      ) {
        return false;
      }
      state.queue.push(run);
      state.statusByIssue[run.issueKey] = status;
      return true;
    });
  }

  async updateQueuedRuntimeReroute(params: {
    issueKey: string;
    requestedCoderAgentId?: string;
    requestedVerifierAgentId?: string;
    requestedAt: string;
    reason: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      const index = state.queue.findIndex((entry) => entry.issueKey === params.issueKey);
      if (index < 0) {
        return undefined;
      }
      const queued = state.queue[index];
      if (!queued) {
        return undefined;
      }
      const next: OpenClawCodeQueuedRun = {
        ...queued,
        request: {
          ...queued.request,
          builderAgent: params.requestedCoderAgentId?.trim() || queued.request.builderAgent,
          verifierAgent: params.requestedVerifierAgentId?.trim() || queued.request.verifierAgent,
          rerunContext: queued.request.rerunContext
            ? {
                ...queued.request.rerunContext,
                requestedAt: params.requestedAt,
                reason: params.reason,
                requestedCoderAgentId:
                  params.requestedCoderAgentId?.trim() ||
                  queued.request.rerunContext.requestedCoderAgentId,
                requestedVerifierAgentId:
                  params.requestedVerifierAgentId?.trim() ||
                  queued.request.rerunContext.requestedVerifierAgentId,
              }
            : queued.request.rerunContext,
        },
      };
      state.queue[index] = next;
      state.statusByIssue[params.issueKey] = `Queued with runtime reroute overrides.`;
      return next;
    });
  }

  async promotePendingApprovalToQueue(params: {
    issueKey: string;
    request: OpenClawCodeChatopsRunRequest;
    fallbackNotifyChannel: string;
    fallbackNotifyTarget: string;
    status?: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (
        state.currentRun?.issueKey === params.issueKey ||
        state.queue.some((entry) => entry.issueKey === params.issueKey)
      ) {
        return undefined;
      }

      const pendingIndex = state.pendingApprovals.findIndex(
        (entry) => entry.issueKey === params.issueKey,
      );
      const pending = pendingIndex >= 0 ? state.pendingApprovals[pendingIndex] : undefined;
      if (pendingIndex >= 0) {
        state.pendingApprovals.splice(pendingIndex, 1);
      }

      const queuedRun: OpenClawCodeQueuedRun = {
        issueKey: params.issueKey,
        request: params.request,
        notifyChannel: pending?.notifyChannel ?? params.fallbackNotifyChannel,
        notifyTarget: pending?.notifyTarget ?? params.fallbackNotifyTarget,
      };
      state.queue.push(queuedRun);
      state.statusByIssue[params.issueKey] = params.status ?? "Queued.";
      return queuedRun;
    });
  }

  async removeQueued(issueKey: string, status = "Skipped before execution."): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.queue.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.queue.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async startNext(status = "Running."): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (state.currentRun) {
        return undefined;
      }
      const next = state.queue.shift();
      if (!next) {
        return undefined;
      }
      state.currentRun = next;
      state.statusByIssue[next.issueKey] = status;
      return next;
    });
  }

  async getActiveProviderPause(
    referenceAt = new Date().toISOString(),
  ): Promise<OpenClawCodeProviderPause | undefined> {
    return await this.mutateState((state) => {
      state.recentProviderFailures = pruneRecentProviderFailures(
        state.recentProviderFailures,
        referenceAt,
      );
      const pause = state.providerPause;
      if (!pause) {
        return undefined;
      }
      if (
        pause.until <= referenceAt ||
        state.recentProviderFailures.length < PROVIDER_FAILURE_THRESHOLD
      ) {
        state.providerPause = undefined;
        return undefined;
      }
      return pause;
    });
  }

  async finishCurrent(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      if (state.currentRun?.issueKey !== issueKey) {
        return;
      }
      state.currentRun = undefined;
      state.statusByIssue[issueKey] = status;
    });
  }

  async recoverInterruptedRun(
    status = "Recovered after restart; waiting to resume.",
  ): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      const current = state.currentRun;
      if (!current) {
        return undefined;
      }
      state.currentRun = undefined;
      if (!state.queue.some((entry) => entry.issueKey === current.issueKey)) {
        state.queue.unshift(current);
      }
      state.statusByIssue[current.issueKey] = status;
      return current;
    });
  }

  async snapshot(): Promise<OpenClawCodeQueueState> {
    await this.flushMutations();
    return await this.loadState();
  }
}
