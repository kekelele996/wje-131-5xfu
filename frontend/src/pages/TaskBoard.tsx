import { Alert, Button, Select, Space, Typography } from 'antd';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { subTaskApi } from '../api/subTask';
import { ProgressBar } from '../components/common/ProgressBar';
import { StatusBadge } from '../components/common/StatusBadge';
import { UserAvatar } from '../components/common/UserAvatar';
import { useProject } from '../hooks/useProject';
import { useTaskStore } from '../stores/taskStore';
import { PhaseStatus, ProjectStatus, TaskStatus } from '../types';

const columns = [TaskStatus.Todo, TaskStatus.InProgress, TaskStatus.Review, TaskStatus.Done];

export function TaskBoard() {
  const id = Number(useParams().id || 1);
  const { project, refresh: refreshProject } = useProject(id);
  const { tasks, phases, loadPhases } = useTaskStore();

  useEffect(() => {
    void loadPhases(id);
  }, [id, loadPhases]);

  const isArchived = project?.status === ProjectStatus.Archived;
  const blockedPhaseIds = new Set(
    phases.filter((phase) => phase.status === PhaseStatus.Blocked).map((phase) => phase.id)
  );
  const locked = isArchived || blockedPhaseIds.size > 0;

  const phaseNameById = new Map(phases.map((phase) => [phase.id, phase.name]));

  const moveTask = async (taskId: number, status: TaskStatus) => {
    await subTaskApi.updateStatus(taskId, status);
    // 刷新看板与项目/阶段汇总，保证看板、甘特图、总览读到同一进度
    await Promise.all([loadPhases(id), refreshProject()]);
  };

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>{project?.name || '项目'} · 任务看板</Typography.Title>
          <Typography.Text type="secondary">按任务状态推进，现场负责人可直接更新流转状态</Typography.Text>
        </div>
        <Button type="primary" disabled={isArchived}>新增子任务</Button>
      </div>

      {isArchived ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="项目已归档"
          description="归档项目的下属任务不得继续推进。"
        />
      ) : blockedPhaseIds.size > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="存在已阻塞阶段"
          description={`${phases
            .filter((phase) => phase.status === PhaseStatus.Blocked)
            .map((phase) => phase.name)
            .join('、')} 已阻塞，阻塞阶段下的子任务暂不能推进。`}
        />
      ) : null}

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
                const taskLocked = isArchived || blockedPhaseIds.has(task.phaseId);
                return (
                  <div className="task-card" key={task.id}>
                    <Typography.Text strong>{task.name}</Typography.Text>
                    <p>{task.description}</p>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <UserAvatar name={task.owner?.name} />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {phaseNameById.get(task.phaseId)}
                        </Typography.Text>
                      </Space>
                      <Select
                        size="small"
                        value={task.status}
                        style={{ width: '100%' }}
                        disabled={taskLocked}
                        options={columns.map((item) => ({ value: item, label: item }))}
                        onChange={(next) => void moveTask(task.id, next)}
                      />
                      {taskLocked && (
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          {isArchived ? '项目已归档' : '阶段已阻塞'}，任务暂停推进
                        </Typography.Text>
                      )}
                    </Space>
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      {!locked && phases.length > 0 && (
        <div className="surface" style={{ marginTop: 16 }}>
          <Typography.Title level={4}>阶段完成率（按已完成子任务占比汇总）</Typography.Title>
          {phases.map((phase) => (
            <Space key={phase.id} style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
              <Space>
                <Typography.Text strong>{phase.name}</Typography.Text>
                <StatusBadge value={phase.status} />
              </Space>
              <div style={{ width: 220 }}>
                <ProgressBar value={phase.percentComplete} size="small" />
              </div>
            </Space>
          ))}
        </div>
      )}
    </>
  );
}
