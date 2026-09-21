import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Project } from '../models/project.entity';
import { SubTask } from '../models/subTask.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus } from '../types/enums';
import { calcPhasePercentComplete, calcProjectProgress, derivePhaseStatus } from '../utils/progressRollup';
import { AuditService } from './audit.service';

@Injectable()
export class ProgressRollupService {
  constructor(
    @InjectRepository(Project) private readonly projectRepository: Repository<Project>,
    @InjectRepository(TaskPhase) private readonly phaseRepository: Repository<TaskPhase>,
    @InjectRepository(SubTask) private readonly taskRepository: Repository<SubTask>,
    private readonly auditService: AuditService
  ) {}

  /**
   * 子任务状态变化后逐级汇总：
   * 1. 阶段完成率按已完成子任务占比重算（阻塞阶段保持现状，不被任务推进覆盖）；
   * 2. 项目进度按各阶段计划工期加权更新。
   */
  async recalculateFromPhase(phaseId: number, actorId?: number, manager?: EntityManager) {
    const run = async (em: EntityManager) => {
      const phase = await em.findOne(TaskPhase, { where: { id: phaseId } });
      if (!phase) {
        return;
      }
      const subTasks = await em.find(SubTask, { where: { phaseId } });

      if (phase.status !== PhaseStatus.Blocked) {
        const percentComplete = calcPhasePercentComplete(subTasks, phase.percentComplete);
        const nextStatus = derivePhaseStatus(percentComplete);
        if (phase.percentComplete !== percentComplete || phase.status !== nextStatus) {
          phase.percentComplete = percentComplete;
          phase.status = nextStatus;
          await em.save(phase);
          await this.auditService.record(
            'phase.progress.rollup',
            'TaskPhase',
            phase.id,
            actorId,
            { percentComplete, status: nextStatus },
            em
          );
        }
      }

      await this.refreshProjectProgress(phase.projectId, actorId, em);
    };

    return manager ? run(manager) : this.projectRepository.manager.transaction(run);
  }

  /**
   * 仅按各阶段当前完成率重新加权项目进度（阶段被手工更新进度后调用）。
   */
  async refreshProjectProgress(projectId: number, actorId?: number, manager?: EntityManager) {
    const run = async (em: EntityManager) => {
      const project = await em.findOne(Project, { where: { id: projectId } });
      if (!project || project.status === ProjectStatus.Archived) {
        return;
      }
      const phases = await em.find(TaskPhase, { where: { projectId } });
      const progress = calcProjectProgress(phases);
      if (project.progress === progress) {
        return;
      }
      project.progress = progress;
      await em.save(project);
      await this.auditService.record(
        'project.progress.rollup',
        'Project',
        project.id,
        actorId,
        { progress },
        em
      );
    };

    return manager ? run(manager) : this.projectRepository.manager.transaction(run);
  }
}
