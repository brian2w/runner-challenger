export function workspaceIdForIntegration(platform: string, externalWorkspaceId: string): string {
  return `workspace:${JSON.stringify([platform, externalWorkspaceId])}`;
}

export function workspaceIntegrationId(platform: string, externalWorkspaceId: string): string {
  return `workspace-integration:${JSON.stringify([platform, externalWorkspaceId])}`;
}

export function memberId(workspaceId: string, platform: string, externalUserId: string): string {
  return `member:${JSON.stringify([workspaceId, platform, externalUserId])}`;
}

export function memberIdentityId(workspaceId: string, platform: string, externalUserId: string): string {
  return `member-identity:${JSON.stringify([workspaceId, platform, externalUserId])}`;
}
