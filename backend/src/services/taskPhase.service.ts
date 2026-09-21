import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus } from '../types/enums';
import { AuditService } from './audit.service';
import { ProgressRollupService } from './progressRollup.service';

@Injectable()
export class TaskPhaseService {
  constructor(
    @InjectRepository(TaskPhase) private readonly phaseRepository: Repository<TaskPhase>,
    private readonly auditService: AuditService,
    private readonly progressRollupService: ProgressRollupService,
    private readonly dataSource: DataSource
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
      throw new BadRequestException('完成率必须在 0-100 之间');
    }

    return this.dataSource.transaction(async (manager) => {
      const phase = await manager.findOne(TaskPhase, { where: { id }, relations: ['project'] });
      if (!phase) {
        throw new NotFoundException('任务阶段不存在');
      }
      if (phase.status === PhaseStatus.Blocked) {
        throw new ConflictException('阶段已阻塞，不得继续推进下属任务');
      }
      if (phase.project && phase.project.status === ProjectStatus.Archived) {
        throw new ConflictException('项目已归档，不得继续推进下属任务');
      }

      phase.percentComplete = percentComplete;
      phase.status = percentComplete >= 100 ? PhaseStatus.Completed : PhaseStatus.InProgress;
      const updated = await manager.save(phase);
      await this.auditService.record('phase.progress.update', 'TaskPhase', id, actorId, { percentComplete }, manager);

      // 项目进度按各阶段计划工期加权更新
      await this.progressRollupService.refreshProjectProgress(phase.projectId, actorId, manager);

      return updated;
    });
  }

  async setBlocked(id: number, blocked: boolean, actorId = 1) {
    const phase = await this.phaseRepository.findOne({ where: { id }, relations: ['project'] });
    if (!phase) {
      throw new NotFoundException('任务阶段不存在');
    }
    if (phase.project && phase.project.status === ProjectStatus.Archived) {
      throw new ConflictException('项目已归档，不得变更阶段状态');
    }
    if (blocked && phase.status === PhaseStatus.Completed) {
      throw new ConflictException('已完成阶段不可阻塞');
    }
    phase.status = blocked ? PhaseStatus.Blocked : PhaseStatus.InProgress;
    const updated = await this.phaseRepository.save(phase);
    await this.auditService.record(blocked ? 'phase.block' : 'phase.unblock', 'TaskPhase', id, actorId);
    return updated;
  }
}
