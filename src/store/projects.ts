import type { StateCreator } from 'zustand';
import type {
  AdvanceProjectResponse,
  CreateProjectArtifactRequest,
  CreateProjectScenarioAssetRequest,
  CreateProjectScenarioPlayerRequest,
  CreateProjectTradeScenarioRequest,
  CreateProjectRequest,
  CreateProjectTaskRequest,
  ProjectDetail,
  ProjectDiagnosis,
  ProjectScenarioValidationKind,
  ProjectStepId,
  ProjectSummary,
  UpdateProjectArtifactRequest,
  UpdateProjectRequest,
  UpdateProjectScenarioAssetRequest,
  UpdateProjectScenarioPlayerRequest,
  UpdateProjectScenarioValidationRequest,
  UpdateProjectTradeScenarioRequest,
  UpdateProjectTaskRequest,
} from '@shared/types';
import {
  advanceProject as advanceProjectApi,
  attachBriefToProject as attachBriefToProjectApi,
  createProjectArtifact as createProjectArtifactApi,
  createProject as createProjectApi,
  createProjectScenario as createProjectScenarioApi,
  createProjectScenarioAsset as createProjectScenarioAssetApi,
  createProjectScenarioPlayer as createProjectScenarioPlayerApi,
  createProjectTask as createProjectTaskApi,
  deleteProjectArtifact as deleteProjectArtifactApi,
  deleteProjectScenarioAsset as deleteProjectScenarioAssetApi,
  deleteProjectScenarioPlayer as deleteProjectScenarioPlayerApi,
  deleteProjectTask as deleteProjectTaskApi,
  diagnoseProject as diagnoseProjectApi,
  duplicateProjectScenario as duplicateProjectScenarioApi,
  generateProjectPackage as generateProjectPackageApi,
  getProject as getProjectApi,
  listProjects as listProjectsApi,
  seedProject as seedProjectApi,
  updateProjectArtifact as updateProjectArtifactApi,
  updateProject as updateProjectApi,
  updateProjectScenario as updateProjectScenarioApi,
  updateProjectScenarioAsset as updateProjectScenarioAssetApi,
  updateProjectScenarioPlayer as updateProjectScenarioPlayerApi,
  updateProjectScenarioValidation as updateProjectScenarioValidationApi,
  updateProjectStageNote as updateProjectStageNoteApi,
  updateProjectTask as updateProjectTaskApi,
  validateProjectScenario as validateProjectScenarioApi,
} from '../api/projects';

export interface ProjectsSlice {
  projects: ProjectSummary[];
  projectsLoaded: boolean;
  activeProjectId: string | null;
  activeScenarioId: string | null;
  activeProjectDetail: ProjectDetail | null;
  activeProjectLoading: boolean;
  projectDiagnosis: ProjectDiagnosis | null;
  setActiveProject: (id: string | null) => void;
  setActiveScenario: (id: string | null) => void;
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<ProjectDetail | null>;
  createProject: (input: CreateProjectRequest) => Promise<ProjectDetail | null>;
  attachBrief: (projectId: string, briefId: string) => Promise<{ project: ProjectDetail; already_attached: boolean } | null>;
  updateProject: (projectId: string, input: UpdateProjectRequest) => Promise<ProjectDetail | null>;
  updateStageNote: (projectId: string, step: ProjectStepId, body: string) => Promise<ProjectDetail | null>;
  createProjectTask: (projectId: string, input: CreateProjectTaskRequest) => Promise<ProjectDetail | null>;
  updateProjectTask: (projectId: string, taskId: string, input: UpdateProjectTaskRequest) => Promise<ProjectDetail | null>;
  deleteProjectTask: (projectId: string, taskId: string) => Promise<ProjectDetail | null>;
  createScenario: (projectId: string, input: CreateProjectTradeScenarioRequest) => Promise<ProjectDetail | null>;
  updateScenario: (projectId: string, scenarioId: string, input: UpdateProjectTradeScenarioRequest) => Promise<ProjectDetail | null>;
  duplicateScenario: (projectId: string, scenarioId: string) => Promise<ProjectDetail | null>;
  createScenarioPlayer: (projectId: string, scenarioId: string, input: CreateProjectScenarioPlayerRequest) => Promise<ProjectDetail | null>;
  updateScenarioPlayer: (projectId: string, scenarioId: string, playerId: string, input: UpdateProjectScenarioPlayerRequest) => Promise<ProjectDetail | null>;
  deleteScenarioPlayer: (projectId: string, scenarioId: string, playerId: string) => Promise<ProjectDetail | null>;
  createScenarioAsset: (projectId: string, scenarioId: string, input: CreateProjectScenarioAssetRequest) => Promise<ProjectDetail | null>;
  updateScenarioAsset: (projectId: string, scenarioId: string, assetId: string, input: UpdateProjectScenarioAssetRequest) => Promise<ProjectDetail | null>;
  deleteScenarioAsset: (projectId: string, scenarioId: string, assetId: string) => Promise<ProjectDetail | null>;
  updateScenarioValidation: (projectId: string, scenarioId: string, kind: ProjectScenarioValidationKind, input: UpdateProjectScenarioValidationRequest) => Promise<ProjectDetail | null>;
  validateScenario: (projectId: string, scenarioId: string) => Promise<ProjectDetail | null>;
  createArtifact: (projectId: string, input: CreateProjectArtifactRequest) => Promise<ProjectDetail | null>;
  updateArtifact: (projectId: string, artifactId: string, input: UpdateProjectArtifactRequest) => Promise<ProjectDetail | null>;
  deleteArtifact: (projectId: string, artifactId: string) => Promise<ProjectDetail | null>;
  advanceProject: (projectId: string, step: ProjectStepId) => Promise<AdvanceProjectResponse | null>;
  seedProject: (projectId: string) => Promise<ProjectDetail | null>;
  diagnoseProject: (projectId: string) => Promise<ProjectDiagnosis | null>;
  generatePackage: (projectId: string) => Promise<ProjectDetail | null>;
}

export const createProjectsSlice: StateCreator<ProjectsSlice, [], [], ProjectsSlice> = (set, get) => ({
  projects: [],
  projectsLoaded: false,
  activeProjectId: null,
  activeScenarioId: null,
  activeProjectDetail: null,
  activeProjectLoading: false,
  projectDiagnosis: null,

  setActiveProject: (id) => set({
    activeProjectId: id,
    activeProjectDetail: id === get().activeProjectDetail?.project.id ? get().activeProjectDetail : null,
    activeScenarioId: null,
    projectDiagnosis: null,
  }),

  setActiveScenario: (id) => set({ activeScenarioId: id }),

  loadProjects: async () => {
    try {
      const projects = await listProjectsApi();
      const activeProjectId = get().activeProjectId && projects.some((project) => project.id === get().activeProjectId)
        ? get().activeProjectId
        : projects[0]?.id ?? null;
      set({ projects, projectsLoaded: true, activeProjectId });
    } catch (err) {
      console.warn('[projects] load failed', err);
      set({ projectsLoaded: true });
    }
  },

  loadProject: async (id) => {
    set({ activeProjectLoading: true, activeProjectId: id });
    try {
      const project = await getProjectApi(id);
      set({ activeProjectDetail: project, activeProjectId: id, activeProjectLoading: false, projectDiagnosis: null });
      return project;
    } catch (err) {
      console.warn('[projects] detail load failed', err);
      set({ activeProjectLoading: false });
      return null;
    }
  },

  createProject: async (input) => {
    const response = await createProjectApi(input);
    set({
      activeProjectId: response.project.project.id,
      activeProjectDetail: response.project,
      activeScenarioId: null,
      projectDiagnosis: null,
    });
    await get().loadProjects();
    return response.project;
  },

  attachBrief: async (projectId, briefId) => {
    const response = await attachBriefToProjectApi(projectId, { brief_id: briefId });
    set({
      activeProjectId: response.project.project.id,
      activeProjectDetail: response.project,
      activeScenarioId: null,
      projectDiagnosis: null,
    });
    await get().loadProjects();
    return { project: response.project, already_attached: response.already_attached };
  },

  updateProject: async (projectId, input) => {
    const response = await updateProjectApi(projectId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateStageNote: async (projectId, step, body) => {
    const response = await updateProjectStageNoteApi(projectId, step, { body });
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  createProjectTask: async (projectId, input) => {
    const response = await createProjectTaskApi(projectId, input);
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateProjectTask: async (projectId, taskId, input) => {
    const response = await updateProjectTaskApi(projectId, taskId, input);
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  deleteProjectTask: async (projectId, taskId) => {
    const response = await deleteProjectTaskApi(projectId, taskId);
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  createScenario: async (projectId, input) => {
    const response = await createProjectScenarioApi(projectId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateScenario: async (projectId, scenarioId, input) => {
    const response = await updateProjectScenarioApi(projectId, scenarioId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  duplicateScenario: async (projectId, scenarioId) => {
    const response = await duplicateProjectScenarioApi(projectId, scenarioId);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  createScenarioPlayer: async (projectId, scenarioId, input) => {
    const response = await createProjectScenarioPlayerApi(projectId, scenarioId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateScenarioPlayer: async (projectId, scenarioId, playerId, input) => {
    const response = await updateProjectScenarioPlayerApi(projectId, scenarioId, playerId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  deleteScenarioPlayer: async (projectId, scenarioId, playerId) => {
    const response = await deleteProjectScenarioPlayerApi(projectId, scenarioId, playerId);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  createScenarioAsset: async (projectId, scenarioId, input) => {
    const response = await createProjectScenarioAssetApi(projectId, scenarioId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateScenarioAsset: async (projectId, scenarioId, assetId, input) => {
    const response = await updateProjectScenarioAssetApi(projectId, scenarioId, assetId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  deleteScenarioAsset: async (projectId, scenarioId, assetId) => {
    const response = await deleteProjectScenarioAssetApi(projectId, scenarioId, assetId);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateScenarioValidation: async (projectId, scenarioId, kind, input) => {
    const response = await updateProjectScenarioValidationApi(projectId, scenarioId, kind, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  validateScenario: async (projectId, scenarioId) => {
    const response = await validateProjectScenarioApi(projectId, scenarioId);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  createArtifact: async (projectId, input) => {
    const response = await createProjectArtifactApi(projectId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  updateArtifact: async (projectId, artifactId, input) => {
    const response = await updateProjectArtifactApi(projectId, artifactId, input);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  deleteArtifact: async (projectId, artifactId) => {
    const response = await deleteProjectArtifactApi(projectId, artifactId);
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  advanceProject: async (projectId, step) => {
    const response = await advanceProjectApi(projectId, { step });
    set({ activeProjectDetail: response.project, activeProjectId: response.project.project.id, projectDiagnosis: null });
    await get().loadProjects();
    return response;
  },

  seedProject: async (projectId) => {
    const response = await seedProjectApi(projectId);
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },

  diagnoseProject: async (projectId) => {
    const response = await diagnoseProjectApi(projectId);
    set({ projectDiagnosis: response.diagnosis });
    return response.diagnosis;
  },

  generatePackage: async (projectId) => {
    const response = await generateProjectPackageApi(projectId);
    set({ activeProjectDetail: response.project, projectDiagnosis: null });
    await get().loadProjects();
    return response.project;
  },
});
