-- Adds the `browser` step kind: a frame of the agent's browser after an action.
alter table task_steps drop constraint if exists task_steps_kind_check;
alter table task_steps add constraint task_steps_kind_check
  check (kind in ('plan', 'tool', 'observation', 'message', 'approval_request', 'result', 'browser'));
