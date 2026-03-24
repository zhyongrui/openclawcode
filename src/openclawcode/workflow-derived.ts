import type { WorkflowRun } from "./contracts/index.js";

export function resolveAutoMergePolicy(run: WorkflowRun): {
  autoMergePolicyEligible: boolean;
  autoMergePolicyReason: string;
} {
  if (run.stage === "completed-without-changes") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "No auto-merge was needed: the run completed without code changes or a pull request.",
    };
  }

  if (run.stage !== "ready-for-human-review" && run.stage !== "merged") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: verification has not approved the run.",
    };
  }

  if (run.stage !== "merged" && run.verificationReport?.decision !== "approve-for-human-review") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: verification has not approved the run.",
    };
  }

  if (run.suitability?.decision !== "auto-run") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: suitability did not accept autonomous execution.",
    };
  }

  if (run.suitability?.overrideApplied) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: manual suitability overrides still require a human merge decision.",
    };
  }

  if (run.buildResult?.issueClassification !== "command-layer") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: the run is not classified as command-layer.",
    };
  }

  if (run.buildResult.scopeCheck?.ok === false) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: the scope check did not pass.",
    };
  }

  if (run.buildResult?.policySignals?.generatedFiles.length) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: generated files were changed and require explicit human review.",
    };
  }

  if (run.buildResult?.policySignals?.largeDiff) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: the changed-line budget exceeded the large-diff threshold.",
    };
  }

  if (run.buildResult?.policySignals?.broadFanOut) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: the change set touched too many files or directories.",
    };
  }

  return {
    autoMergePolicyEligible: true,
    autoMergePolicyReason: "Eligible for auto-merge under the current command-layer policy.",
  };
}

export function resolveAutoMergeDisposition(run: WorkflowRun): {
  autoMergeDisposition: "merged" | "skipped" | "failed" | null;
  autoMergeDispositionReason: string | null;
} {
  const note = [...(run.history ?? [])]
    .toReversed()
    .find(
      (entry) =>
        entry === "Pull request merged automatically" ||
        entry.startsWith("Auto-merge skipped:") ||
        entry.startsWith("Auto-merge failed:"),
    );

  if (note === "Pull request merged automatically") {
    return {
      autoMergeDisposition: "merged",
      autoMergeDispositionReason: note,
    };
  }

  if (note?.startsWith("Auto-merge skipped:")) {
    return {
      autoMergeDisposition: "skipped",
      autoMergeDispositionReason: note,
    };
  }

  if (note?.startsWith("Auto-merge failed:")) {
    return {
      autoMergeDisposition: "failed",
      autoMergeDispositionReason: note,
    };
  }

  return {
    autoMergeDisposition: null,
    autoMergeDispositionReason: null,
  };
}
