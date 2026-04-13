export const WORK_ITEM_ID_MARKER = "openclawcode-work-item-id";
export const BLUEPRINT_REVISION_MARKER = "openclawcode-blueprint-revision";
export const WORK_ITEM_FINGERPRINT_MARKER = "openclawcode-work-item-fingerprint";

export function buildProjectWorkItemIssueMarkers(params: {
  workItemId: string;
  blueprintRevisionId: string | null;
  workItemFingerprint?: string | null;
}): string[] {
  return [
    `<!-- ${WORK_ITEM_ID_MARKER}: ${params.workItemId} -->`,
    `<!-- ${BLUEPRINT_REVISION_MARKER}: ${params.blueprintRevisionId ?? "unknown"} -->`,
    ...(params.workItemFingerprint
      ? [`<!-- ${WORK_ITEM_FINGERPRINT_MARKER}: ${params.workItemFingerprint} -->`]
      : []),
  ];
}
