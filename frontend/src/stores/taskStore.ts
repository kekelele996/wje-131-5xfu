import { create } from 'zustand';
import { subTaskApi } from '../api/subTask';
import { taskPhaseApi } from '../api/taskPhase';
import { SubTask, TaskPhase, TaskStatus, TimesheetRow } from '../types';
import { useProjectStore } from './projectStore';

interface TaskState {
  phases: TaskPhase[];
  tasks: SubTask[];
  timesheet: TimesheetRow[];
  loadPhases: (projectId: number) => Promise<void>;
  loadTasks: (phaseId: number) => Promise<void>;
  loadTimesheet: () => Promise<void>;
  /** 子任务状态流转：后端逐级重算阶段完成率与项目进度，成功后同步刷新阶段与项目，保证看板/甘特图/总览口径一致 */
  moveTask: (taskId: number, status: TaskStatus, projectId: number) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set) => ({
  phases: [],
  tasks: [],
  timesheet: [],
  loadPhases: async (projectId) => {
    const phases = await taskPhaseApi.listByProject(projectId);
    set({ phases, tasks: phases.flatMap((phase) => phase.subTasks || []) });
  },
  loadTasks: async (phaseId) => {
    const tasks = await subTaskApi.listByPhase(phaseId);
    set({ tasks });
  },
  loadTimesheet: async () => {
    const timesheet = await subTaskApi.timesheet();
    set({ timesheet });
  },
  moveTask: async (taskId, status, projectId) => {
    await subTaskApi.updateStatus(taskId, status);
    const phases = await taskPhaseApi.listByProject(projectId);
    set({ phases, tasks: phases.flatMap((phase) => phase.subTasks || []) });
    // 项目进度由 projectStore 统一持有，刷新后看板、甘特图、总览读到同一份进度
    await useProjectStore.getState().loadProject(projectId);
  }
}));
