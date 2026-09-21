import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../models/project.entity';
import { SubTask } from '../models/subTask.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus, TaskStatus } from '../types/enums';
import { AuditService } from './audit.service';
import { ProgressRollupService } from './progressRollup.service';

@Injectable()
export class SubTaskService {
  constructor(
    @InjectRepository(SubTask) private readonly taskRepository: Repository<SubTask>,
    private readonly auditService: AuditService,
    private readonly progressRollupService: ProgressRollupService,
    private readonly dataSource: DataSource
  ) {}

  async findByPhase(phaseId: number) {
    return this.taskRepository.find({ where: { phaseId }, order: { id: 'ASC' } });
  }

  async create(payload: Partial<SubTask>, actorId = 1) {
    const task = await this.taskRepository.save(this.taskRepository.create(payload));
    await this.auditService.record('subtask.create', 'SubTask', task.id, actorId, payload);
    return task;
  }

  async updateStatus(id: number, status: TaskStatus, actorId = 1) {
    if (!status || !Object.values(TaskStatus).includes(status)) {
      throw new BadRequestException('子任务状态不合法');
    }

    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(SubTask, { where: { id } });
      if (!task) {
        throw new NotFoundException('子任务不存在');
      }

      const phase = await manager.findOne(TaskPhase, {
        where: { id: task.phaseId },
        relations: ['project']
      });
      if (!phase) {
        throw new NotFoundException('任务阶段不存在');
      }
      if (phase.status === PhaseStatus.Blocked) {
        throw new ConflictException('阶段已阻塞，不得继续推进下属任务');
      }
      if (phase.project && phase.project.status === ProjectStatus.Archived) {
        throw new ConflictException('项目已归档，不得继续推进下属任务');
      }

      if (task.status === status) {
        return task;
      }

      task.status = status;
      task.completedAt = status === TaskStatus.Done ? new Date().toISOString().slice(0, 10) : null;
      const updated = await manager.save(task);
      await this.auditService.record('subtask.status.update', 'SubTask', id, actorId, { status }, manager);

      // 同一事务内逐级汇总，任一更新失败则任务/阶段/项目/日志全部回滚
      await this.progressRollupService.recalculateFromPhase(phase.id, actorId, manager);

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
