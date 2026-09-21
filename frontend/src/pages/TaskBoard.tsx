import { Alert, Button, Select, Space, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ProgressBar } from '../components/common/ProgressBar';
import { StatusBadge } from '../components/common/StatusBadge';
import { UserAvatar } from '../components/common/UserAvatar';
import { useProject } from '../hooks/useProject';
import { useTaskStore } from '../stores/taskStore';
import { PhaseStatus, ProjectStatus, TaskStatus } from '../types';
import { formatDuration } from '../utils/formatDuration';

const columns = [TaskStatus.Todo, TaskStatus.InProgress, TaskStatus.Review, TaskStatus.Done];

export function TaskBoard() {
  const id = Number(useParams().id || 1);
  const { project } = useProject(id);
  const { tasks, phases, loadPhases, moveTask } = useTaskStore();

  useEffect(() => {
    void loadPhases(id);
  }, [id, loadPhases]);

  const projectArchived = project?.status === ProjectStatus.Archived;
  const blockedPhaseIds = new Set(
    phases.filter((phase) => phase.status === PhaseStatus.Blocked).map((phase) => phase.id)
  );
  const phaseNameById = new Map(phases.map((phase) => [phase.id, phase.name]));

  const isFrozen = (task: { phaseId: number }) => projectArchived || blockedPhaseIds.has(task.phaseId);

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>{project?.name || '项目'} · 任务看板</Typography.Title>
          <Typography.Text type="secondary">按任务状态推进，现场负责人可直接更新流转状态</Typography.Text>
        </div>
        <Button type="primary" disabled={projectArchived}>新增子任务</Button>
      </div>

      <div className="surface" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>项目整体进度（按阶段计划工期加权）</Typography.Text>
          <StatusBadge value={project?.status ?? ''} />
        </Space>
        <ProgressBar value={project?.progress || 0} />
      </div>

      {projectArchived && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="项目已归档"
          description="归档项目不再推进下属任务，看板上的子任务状态已锁定。"
        />
      )}
      {blockedPhaseIds.size > 0 && !projectArchived && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="存在已阻塞阶段"
          description={`阶段「${[...blockedPhaseIds].map((phaseId) => phaseNameById.get(phaseId)).join('、')}」已阻塞，子任务只能回退或保持现状，不能继续推进；解除阻塞后才能恢复流转。`}
        />
      )}

      <div className="board">
        {columns.map((status) => (
          <div className="board-column" key={status}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <StatusBadge value={status} />
              <Typography.Text type="secondary">{tasks.filter((task) => task.status === status).length}</Typography.Text>
            </Space>
            {tasks
              .filter((task) => task.status === status)
              .map((task) => {
                const frozen = isFrozen(task);
                return (
                  <div className="task-card" key={task.id}>
                    <Typography.Text strong>{task.name}</Typography.Text>
                    <p>{task.description}</p>
                    <Space style={{ marginBottom: 8 }}>
                      <Tag>{phaseNameById.get(task.phaseId) || '未分阶段'}</Tag>
                      {frozen && <Tag color="error">{projectArchived ? '项目归档' : '阶段阻塞'}</Tag>}
                    </Space>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <UserAvatar name={task.owner?.name} />
                      <Typography.Text type="secondary">
                        计划 {formatDuration(task.estimatedHours)} / 实际 {formatDuration(task.actualHours)}
                      </Typography.Text>
                      <Select
                        size="small"
                        value={task.status}
                        disabled={frozen}
                        style={{ width: '100%' }}
                        options={columns.map((item) => ({ value: item, label: item }))}
                        onChange={(next) => {
                          void moveTask(task.id, next, id).catch(() => undefined);
                        }}
                      />
                    </Space>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </>
  );
}
