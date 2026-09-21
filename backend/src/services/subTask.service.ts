import { ConflictException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../models/project.entity';
import { SubTask } from '../models/subTask.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus, TaskStatus } from '../types/enums';
import { AuditService } from './audit.service';
import { isForwardTaskTransition, ProgressRollupService } from './progressRollup.service';

@Injectable()
export class SubTaskService {
  constructor(
    @InjectRepository(SubTask) private readonly taskRepository: Repository<SubTask>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly progressRollupService: ProgressRollupService
  ) {}

  async findByPhase(phaseId: number) {
    return this.taskRepository.find({ where: { phaseId }, order: { id: 'ASC' } });
  }

  async create(payload: Partial<SubTask>, actorId = 1) {
    // 新增子任务同样参与逐级汇总；项目已归档时不再增加任务
    return this.dataSource.transaction(async (manager) => {
      if (payload.phaseId) {
        const phase = await manager.findOneBy(TaskPhase, { id: payload.phaseId });
        if (!phase) {
          throw new NotFoundException('任务阶段不存在');
        }
        const project = await manager.findOneBy(Project, { id: phase.projectId });
        if (project?.status === ProjectStatus.Archived) {
          throw new ConflictException('项目已归档，不能继续推进下属任务');
        }
      }
      const task = await manager.save(manager.create(SubTask, payload));
      await this.auditService.record('subtask.create', 'SubTask', task.id, actorId, payload as Record<string, unknown>, manager);
      if (task.phaseId) {
        await this.progressRollupService.recalcPhase(manager, task.phaseId);
        const phase = await manager.findOneBy(TaskPhase, { id: task.phaseId });
        if (phase) {
          await this.progressRollupService.recalcProject(manager, phase.projectId);
        }
      }
      return task;
    });
  }

  async updateStatus(id: number, status: TaskStatus, actorId = 1) {
    if (!Object.values(TaskStatus).includes(status)) {
      throw new BadRequestException('非法的子任务状态');
    }
    // 子任务状态变化 → 阶段完成率（已完成子任务占比）→ 项目进度（阶段计划工期加权）
    // 整个链路与操作日志在同一事务内：任一更新失败，任务、阶段、项目和操作日志全部保持原样
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOneBy(SubTask, { id });
      if (!task) {
        throw new NotFoundException('子任务不存在');
      }
      const phase = await manager.findOneBy(TaskPhase, { id: task.phaseId });
      if (!phase) {
        throw new NotFoundException('任务阶段不存在');
      }
      const project = await manager.findOneBy(Project, { id: phase.projectId });
      if (!project) {
        throw new NotFoundException('项目不存在');
      }

      if (project.status === ProjectStatus.Archived) {
        throw new ConflictException('项目已归档，不能继续推进下属任务');
      }
      if (phase.status === PhaseStatus.Blocked && isForwardTaskTransition(task.status, status)) {
        throw new ConflictException('阶段已阻塞，不能继续推进下属任务');
      }

      const previousStatus = task.status;
      task.status = status;
      task.completedAt = status === TaskStatus.Done ? new Date().toISOString().slice(0, 10) : null;
      const updated = await manager.save(task);

      await this.progressRollupService.recalcPhase(manager, phase.id);
      await this.progressRollupService.recalcProject(manager, project.id);

      await this.auditService.record(
        'subtask.status.update',
        'SubTask',
        id,
        actorId,
        { previousStatus, status },
        manager
      );
      return updated;
    });
  }

  async timesheet() {
    const tasks = await this.taskRepository.find({ relations: ['owner', 'phase'] });
    const rows = tasks.reduce<Record<number, { userId: number; userName: string; plannedHours: number; actualHours: number; utilization: number }>>(
      (acc, task) => {
        const key = task.ownerId;
        acc[key] ||= { userId: task.ownerId, userName: task.owner.name, plannedHours: 0, actualHours: 0, utilization: 0 };
        acc[key].plannedHours += Number(task.estimatedHours);
        acc[key].actualHours += Number(task.actualHours);
        acc[key].utilization = acc[key].plannedHours ? Math.round((acc[key].actualHours / acc[key].plannedHours) * 100) : 0;
        return acc;
      },
      {}
    );
    return Object.values(rows);
  }
}
