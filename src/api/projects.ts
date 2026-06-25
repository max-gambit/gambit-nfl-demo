import type {
  AdvanceProjectRequest,
  AdvanceProjectResponse,
  AttachProjectBriefRequest,
  AttachProjectBriefResponse,
  CreateProjectArtifactRequest,
  CreateProjectScenarioAssetRequest,
  CreateProjectScenarioPlayerRequest,
  CreateProjectTradeScenarioRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateProjectTaskRequest,
  DeleteProjectArtifactResponse,
  DeleteProjectScenarioAssetResponse,
  DeleteProjectScenarioPlayerResponse,
  DeleteProjectTaskResponse,
  DiagnoseProjectResponse,
  DuplicateProjectTradeScenarioResponse,
  GenerateProjectPackageResponse,
  GetProjectResponse,
  ListProjectsResponse,
  ProjectDetail,
  ProjectArtifactResponse,
  ProjectScenarioAssetResponse,
  ProjectScenarioPlayerResponse,
  ProjectScenarioValidationKind,
  ProjectScenarioValidationResponse,
  ProjectSummary,
  ProjectTradeScenarioResponse,
  UpdateProjectRequest,
  UpdateProjectArtifactRequest,
  UpdateProjectScenarioAssetRequest,
  UpdateProjectScenarioPlayerRequest,
  UpdateProjectScenarioValidationRequest,
  UpdateProjectTradeScenarioRequest,
  UpdateProjectResponse,
  UpdateProjectStageNoteRequest,
  UpdateProjectStageNoteResponse,
  UpdateProjectTaskRequest,
  ProjectTaskResponse,
  ValidateProjectScenarioResponse,
} from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${SERVER_URL}/projects`);
  if (!res.ok) await throwHttp('GET /projects', res);
  const body = await res.json() as ListProjectsResponse;
  return body.projects;
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const res = await fetch(`${SERVER_URL}/projects/${projectId}`);
  if (!res.ok) await throwHttp(`GET /projects/${projectId}`, res);
  const body = await res.json() as GetProjectResponse;
  return body.project;
}

export async function createProject(req: CreateProjectRequest): Promise<CreateProjectResponse> {
  return postJson<CreateProjectResponse>('/projects', req);
}

export async function attachBriefToProject(
  projectId: string,
  req: AttachProjectBriefRequest,
): Promise<AttachProjectBriefResponse> {
  return postJson<AttachProjectBriefResponse>(`/projects/${projectId}/briefs`, req);
}

export async function updateProject(
  projectId: string,
  req: UpdateProjectRequest,
): Promise<UpdateProjectResponse> {
  return patchJson<UpdateProjectResponse>(`/projects/${projectId}`, req);
}

export async function updateProjectStageNote(
  projectId: string,
  step: string,
  req: UpdateProjectStageNoteRequest,
): Promise<UpdateProjectStageNoteResponse> {
  return patchJson<UpdateProjectStageNoteResponse>(`/projects/${projectId}/stages/${step}/note`, req);
}

export async function createProjectTask(
  projectId: string,
  req: CreateProjectTaskRequest,
): Promise<ProjectTaskResponse> {
  return postJson<ProjectTaskResponse>(`/projects/${projectId}/tasks`, req);
}

export async function createProjectScenario(
  projectId: string,
  req: CreateProjectTradeScenarioRequest,
): Promise<ProjectTradeScenarioResponse> {
  return postJson<ProjectTradeScenarioResponse>(`/projects/${projectId}/scenarios`, req);
}

export async function updateProjectScenario(
  projectId: string,
  scenarioId: string,
  req: UpdateProjectTradeScenarioRequest,
): Promise<ProjectTradeScenarioResponse> {
  return patchJson<ProjectTradeScenarioResponse>(`/projects/${projectId}/scenarios/${scenarioId}`, req);
}

export async function duplicateProjectScenario(
  projectId: string,
  scenarioId: string,
): Promise<DuplicateProjectTradeScenarioResponse> {
  return postJson<DuplicateProjectTradeScenarioResponse>(`/projects/${projectId}/scenarios/${scenarioId}/duplicate`, {});
}

export async function createProjectScenarioPlayer(
  projectId: string,
  scenarioId: string,
  req: CreateProjectScenarioPlayerRequest,
): Promise<ProjectScenarioPlayerResponse> {
  return postJson<ProjectScenarioPlayerResponse>(`/projects/${projectId}/scenarios/${scenarioId}/players`, req);
}

export async function updateProjectScenarioPlayer(
  projectId: string,
  scenarioId: string,
  playerId: string,
  req: UpdateProjectScenarioPlayerRequest,
): Promise<ProjectScenarioPlayerResponse> {
  return patchJson<ProjectScenarioPlayerResponse>(`/projects/${projectId}/scenarios/${scenarioId}/players/${playerId}`, req);
}

export async function deleteProjectScenarioPlayer(
  projectId: string,
  scenarioId: string,
  playerId: string,
): Promise<DeleteProjectScenarioPlayerResponse> {
  const res = await fetch(`${SERVER_URL}/projects/${projectId}/scenarios/${scenarioId}/players/${playerId}`, { method: 'DELETE' });
  if (!res.ok) await throwHttp(`DELETE /projects/${projectId}/scenarios/${scenarioId}/players/${playerId}`, res);
  return res.json() as Promise<DeleteProjectScenarioPlayerResponse>;
}

export async function createProjectScenarioAsset(
  projectId: string,
  scenarioId: string,
  req: CreateProjectScenarioAssetRequest,
): Promise<ProjectScenarioAssetResponse> {
  return postJson<ProjectScenarioAssetResponse>(`/projects/${projectId}/scenarios/${scenarioId}/assets`, req);
}

export async function updateProjectScenarioAsset(
  projectId: string,
  scenarioId: string,
  assetId: string,
  req: UpdateProjectScenarioAssetRequest,
): Promise<ProjectScenarioAssetResponse> {
  return patchJson<ProjectScenarioAssetResponse>(`/projects/${projectId}/scenarios/${scenarioId}/assets/${assetId}`, req);
}

export async function deleteProjectScenarioAsset(
  projectId: string,
  scenarioId: string,
  assetId: string,
): Promise<DeleteProjectScenarioAssetResponse> {
  const res = await fetch(`${SERVER_URL}/projects/${projectId}/scenarios/${scenarioId}/assets/${assetId}`, { method: 'DELETE' });
  if (!res.ok) await throwHttp(`DELETE /projects/${projectId}/scenarios/${scenarioId}/assets/${assetId}`, res);
  return res.json() as Promise<DeleteProjectScenarioAssetResponse>;
}

export async function updateProjectScenarioValidation(
  projectId: string,
  scenarioId: string,
  kind: ProjectScenarioValidationKind,
  req: UpdateProjectScenarioValidationRequest,
): Promise<ProjectScenarioValidationResponse> {
  return patchJson<ProjectScenarioValidationResponse>(`/projects/${projectId}/scenarios/${scenarioId}/validations/${kind}`, req);
}

export async function validateProjectScenario(
  projectId: string,
  scenarioId: string,
): Promise<ValidateProjectScenarioResponse> {
  return postJson<ValidateProjectScenarioResponse>(`/projects/${projectId}/scenarios/${scenarioId}/validate`, {});
}

export async function createProjectArtifact(
  projectId: string,
  req: CreateProjectArtifactRequest,
): Promise<ProjectArtifactResponse> {
  return postJson<ProjectArtifactResponse>(`/projects/${projectId}/artifacts`, req);
}

export async function updateProjectArtifact(
  projectId: string,
  artifactId: string,
  req: UpdateProjectArtifactRequest,
): Promise<ProjectArtifactResponse> {
  return patchJson<ProjectArtifactResponse>(`/projects/${projectId}/artifacts/${artifactId}`, req);
}

export async function deleteProjectArtifact(
  projectId: string,
  artifactId: string,
): Promise<DeleteProjectArtifactResponse> {
  const res = await fetch(`${SERVER_URL}/projects/${projectId}/artifacts/${artifactId}`, { method: 'DELETE' });
  if (!res.ok) await throwHttp(`DELETE /projects/${projectId}/artifacts/${artifactId}`, res);
  return res.json() as Promise<DeleteProjectArtifactResponse>;
}

export async function updateProjectTask(
  projectId: string,
  taskId: string,
  req: UpdateProjectTaskRequest,
): Promise<ProjectTaskResponse> {
  return patchJson<ProjectTaskResponse>(`/projects/${projectId}/tasks/${taskId}`, req);
}

export async function deleteProjectTask(
  projectId: string,
  taskId: string,
): Promise<DeleteProjectTaskResponse> {
  const res = await fetch(`${SERVER_URL}/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) await throwHttp(`DELETE /projects/${projectId}/tasks/${taskId}`, res);
  return res.json() as Promise<DeleteProjectTaskResponse>;
}

export async function advanceProject(
  projectId: string,
  req: AdvanceProjectRequest,
): Promise<AdvanceProjectResponse> {
  return postJson<AdvanceProjectResponse>(`/projects/${projectId}/advance`, req);
}

export async function seedProject(projectId: string): Promise<GetProjectResponse> {
  return postJson<GetProjectResponse>(`/projects/${projectId}/ai/seed`, {});
}

export async function diagnoseProject(projectId: string): Promise<DiagnoseProjectResponse> {
  return postJson<DiagnoseProjectResponse>(`/projects/${projectId}/ai/diagnose`, {});
}

export async function generateProjectPackage(projectId: string): Promise<GenerateProjectPackageResponse> {
  return postJson<GenerateProjectPackageResponse>(`/projects/${projectId}/package/generate`, {});
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwHttp(`PATCH ${path}`, res);
  return res.json() as Promise<T>;
}

async function throwHttp(label: string, res: Response): Promise<never> {
  const text = await res.text().catch(() => '');
  throw new Error(`${label} failed: ${res.status} ${text}`);
}
