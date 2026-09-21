import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus } from '../types/enums';
import { AuditService } from './audit.service';
import { derivePhaseStatus, ProgressRollupService } from './progressRollup.service';

@Injectable()
export class TaskPhaseService {
  constructor(
    @InjectRepository(TaskPhase) private readonly phaseRepository: Repository<TaskPhase>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly progressRollupService: ProgressRollupService
  ) {}

  async findByProject(projectId: number) {
    return this.phaseRepository.find({ where: { projectId }, relations: ['subTasks'], order: { plannedStartDate: 'ASC' } });
  }

  async create(payload: Partial<TaskPhase>, actorId = 1) {
    const phase = await this.phaseRepository.save(this.phaseRepository.create(payload));
    await this.auditService.record('phase.create', 'TaskPhase', phase.id, actorId, payload);
    return phase;
  }

  async updateProgress(id: number, percentComplete: number, actorId = 1) {
    if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
      throw new BadRequestException('完成百分比必须在 0 到 100 之间');
    }
    // 阶段进度变化后同步重算项目加权进度；失败则阶段、项目与操作日志保持原样
    return this.dataSource.transaction(async (manager) => {
      const phase = await manager.findOneBy(TaskPhase, { id });
      if (!phase) {
        throw new NotFoundException('任务阶段不存在');
      }
      phase.percentComplete = Math.round(percentComplete);
      if (phase.status !== PhaseStatus.Blocked) {
        phase.status = derivePhaseStatus(phase.percentComplete);
      }
      const updated = await manager.save(phase);
      await this.progressRollupService.recalcProject(manager, phase.projectId);
      await this.auditService.record('phase.progress.update', 'TaskPhase', id, actorId, { percentComplete: phase.percentComplete }, manager);
      return updated;
    });
  }

  async setBlocked(id: number, blocked: boolean, actorId = 1) {
    // 阻塞/解除阻塞与项目进度重算放在同一事务，失败时全部保持原样
    return this.dataSource.transaction(async (manager) => {
      const phase = await manager.findOneBy(TaskPhase, { id });
      if (!phase) {
        throw new NotFoundException('任务阶段不存在');
      }
      phase.status = blocked ? PhaseStatus.Blocked : derivePhaseStatus(phase.percentComplete);
      const updated = await manager.save(phase);
      await this.progressRollupService.recalcProject(manager, phase.projectId);
      await this.auditService.record(blocked ? 'phase.block' : 'phase.unblock', 'TaskPhase', id, actorId, undefined, manager);
      return updated;
    });
  }
}
