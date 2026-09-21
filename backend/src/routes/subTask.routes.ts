import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../models/auditLog.entity';
import { Project } from '../models/project.entity';
import { SubTask } from '../models/subTask.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { SubTaskController } from '../controllers/subTask.controller';
import { AuditService } from '../services/audit.service';
import { ProgressRollupService } from '../services/progressRollup.service';
import { SubTaskService } from '../services/subTask.service';

@Module({
  imports: [TypeOrmModule.forFeature([SubTask, TaskPhase, Project, AuditLog])],
  controllers: [SubTaskController],
  providers: [SubTaskService, AuditService, ProgressRollupService]
})
export class SubTaskRoutesModule {}
