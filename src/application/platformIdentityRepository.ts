export interface WorkspaceIntegration {
  id: string;
  workspaceId: string;
  platform: string;
  externalWorkspaceId: string;
  createdAt: string;
}

export interface MemberIdentity {
  id: string;
  workspaceId: string;
  memberId: string;
  platform: string;
  externalUserId: string;
  createdAt: string;
}

export interface PlatformIdentityRepository {
  saveWorkspaceIntegration(integration: WorkspaceIntegration): Promise<void>;
  getWorkspaceIntegration(platform: string, externalWorkspaceId: string): Promise<WorkspaceIntegration | undefined>;
  saveMemberIdentity(identity: MemberIdentity): Promise<void>;
  getMemberIdentity(
    workspaceId: string,
    platform: string,
    externalUserId: string,
  ): Promise<MemberIdentity | undefined>;
  listMemberIdentities(memberId: string): Promise<MemberIdentity[]>;
}
