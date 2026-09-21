import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Project } from '../models/project.entity';
import { SubTask } from '../models/subTask.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, TaskStatus } from '../types/enums';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** 计划工期（天），首尾日期都计入工期；非法日期返回 1 天兜底 */
export function plannedDurationDays(phase: Pick<TaskPhase, 'plannedStartDate' | 'plannedEndDate'>): number {
  const start = new Date(phase.plannedStartDate).getTime();
  const end = new Date(phase.plannedEndDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 1;
  }
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** 阶段完成率：按已完成（Done）子任务占比计算，无下属子任务时保持 0 */
export function calcPhasePercent(subTasks: Pick<SubTask, 'status'>[]): number {
  if (!subTasks.length) {
    return 0;
  }
  const doneCount = subTasks.filter((task) => task.status === TaskStatus.Done).length;
  return Math.round((doneCount / subTasks.length) * 100);
}

/** 阶段完成率推导阶段状态；阻塞状态由阻塞接口单独维护，不由汇总推导 */
export function derivePhaseStatus(percent: number): PhaseStatus {
  if (percent >= 100) {
    return PhaseStatus.Completed;
  }
  if (percent <= 0) {
    return PhaseStatus.Pending;
  }
  return PhaseStatus.InProgress;
}

/** 项目进度：按各阶段计划工期加权平均 */
export function calcProjectProgress(phases: Array<Pick<TaskPhase, 'plannedStartDate' | 'plannedEndDate' | 'percentComplete'>>): number {
  if (!phases.length) {
    return 0;
  }
  const totalWeight = phases.reduce((sum, phase) => sum + plannedDurationDays(phase), 0);
  const weighted = phases.reduce((sum, phase) => sum + Number(phase.percentComplete || 0) * plannedDurationDays(phase), 0);
  return totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
}

/** 子任务状态流转方向：序号增大为推进，减小为回退 */
const TASK_STATUS_ORDER: TaskStatus[] = [TaskStatus.Todo, TaskStatus.InProgress, TaskStatus.Review, TaskStatus.Done];

export function isForwardTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_ORDER.indexOf(to) > TASK_STATUS_ORDER.indexOf(from);
}

/**
 * 施工进度逐级汇总：子任务 → 阶段 → 项目。
 * 仅负责汇总计算与持久化，状态推进的阻塞/归档校验由调用方完成。
 */
@Injectable()
export class ProgressRollupService {
  /** 按已完成子任务占比重算阶段完成率与状态 */
  async recalcPhase(manager: EntityManager, phaseId: number): Promise<TaskPhase> {
    const phase = await manager.findOneBy(TaskPhase, { id: phaseId });
    if (!phase) {
      throw new NotFoundException('任务阶段不存在');
    }
    const subTasks = await manager.findBy(SubTask, { phaseId });
    const percentComplete = calcPhasePercent(subTasks);
    phase.percentComplete = percentComplete;
    if (phase.status !== PhaseStatus.Blocked) {
      phase.status = derivePhaseStatus(percentComplete);
    }
    return manager.save(phase);
  }

  /** 按各阶段计划工期加权重算项目进度（不改项目状态） */
  async recalcProject(manager: EntityManager, projectId: number): Promise<Project> {
    const project = await manager.findOneBy(Project, { id: projectId });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    const phases = await manager.findBy(TaskPhase, { projectId });
    project.progress = calcProjectProgress(phases);
    return manager.save(project);
  }
}
