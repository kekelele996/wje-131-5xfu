import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../models/auditLog.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>
  ) {}

  async record(
    action: string,
    resource: string,
    resourceId?: number,
    actorId?: number,
    payload?: Record<string, unknown>,
    manager?: EntityManager
  ) {
    const log = this.auditRepository.create({ action, resource, resourceId, actorId, payload });
    return manager ? manager.save(log) : this.auditRepository.save(log);
  }

  async list() {
    return this.auditRepository.find({ order: { createdAt: 'DESC' }, take: 50 });
  }
}
