import { PhaseStatus, TaskStatus } from '../types/enums';

interface RollupSubTask {
  status: TaskStatus;
}

interface RollupPhase {
  plannedStartDate: string;
  plannedEndDate: string;
  percentComplete: number;
  status: PhaseStatus;
}

/** 计划工期（天），开始与结束日期各计一天；非法日期区间返回 0 */
export function plannedDuration(plannedStartDate: string, plannedEndDate: string): number {
  const start = new Date(plannedStartDate).getTime();
  const end = new Date(plannedEndDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 0;
  }
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * 阶段完成率：已完成（Done）子任务占全部子任务的比例。
 * 无子任务时沿用阶段现有进度，视为 0%。
 */
export function calcPhasePercentComplete(subTasks: RollupSubTask[], fallback = 0): number {
  if (subTasks.length === 0) {
    return fallback;
  }
  const doneCount = subTasks.filter((task) => task.status === TaskStatus.Done).length;
  return Math.round((doneCount / subTasks.length) * 100);
}

/** 依据完成率推导阶段状态：100% 完成，否则进行中 */
export function derivePhaseStatus(percentComplete: number): PhaseStatus {
  return percentComplete >= 100 ? PhaseStatus.Completed : PhaseStatus.InProgress;
}

/**
 * 项目进度：按各阶段计划工期加权平均。
 * 阻塞阶段保留其当前完成率参与加权；无有效工期阶段时回退为简单平均。
 */
export function calcProjectProgress(phases: RollupPhase[]): number {
  if (phases.length === 0) {
    return 0;
  }
  const weighted = phases.reduce((sum, phase) => {
    return sum + phase.percentComplete * plannedDuration(phase.plannedStartDate, phase.plannedEndDate);
  }, 0);
  const totalDuration = phases.reduce(
    (sum, phase) => sum + plannedDuration(phase.plannedStartDate, phase.plannedEndDate),
    0
  );
  if (totalDuration <= 0) {
    return Math.round(phases.reduce((sum, phase) => sum + phase.percentComplete, 0) / phases.length);
  }
  return Math.round(weighted / totalDuration);
}
