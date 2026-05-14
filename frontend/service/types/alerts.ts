export type AlertChannelType = "in_app" | "discord" | "telegram";
export type WorkflowStatus = "active" | "inactive" | "draft" | "validated" | "paused" | "error";
export type EditorMode = "rule" | "graph";

export interface AlertCondition {
  field: string;
  operator: string;
  value?: string | number | boolean | null;
  window_seconds?: number | null;
  compare_to?: string | null;
}

export interface AlertNotificationConfig {
  level: string;
  title_template: string;
  message_template: string;
}

export interface AlertChannelSelection {
  inherit_defaults: boolean;
  enabled: AlertChannelType[];
}

export interface AlertTargetEntry {
  symbol: string;
  exchange?: string | null;
  instrument_ref: InstrumentRef;
  label?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface AlertWorkflowTargeting {
  mode: "single_symbol" | "symbol_list" | "preset_universe";
  entries: AlertTargetEntry[];
  preset_id?: string | null;
  preset_label?: string | null;
  filters: Record<string, unknown>;
}

export interface AlertWorkflowDsl {
  version?: number;
  combine: "all" | "any";
  cooldown_seconds: number;
  conditions: AlertCondition[];
  targeting: AlertWorkflowTargeting;
  notification: AlertNotificationConfig;
  channels: AlertChannelSelection;
  workflow_ast?: Record<string, unknown> | null;
  dsl_text?: string | null;
  validation_status?: "unknown" | "valid" | "invalid";
  compiled_summary?: Record<string, unknown>;
}

export interface AlertGraphNode {
  id: string;
  kind: "trigger" | "condition" | "notification" | "channel";
  label: string;
  config: unknown;
}

export interface AlertGraphEdge {
  source: string;
  target: string;
}

export interface AlertGraphDsl {
  nodes: AlertGraphNode[];
  edges: AlertGraphEdge[];
}

export interface InstrumentRef {
  symbol?: string | null;
  exchange?: string | null;
  zerodha_instrument_token?: number | null;
  upstox_instrument_key?: string | null;
  angel_exchange?: string | null;
  angel_token?: number | null;
  dhan_exchange_segment?: string | null;
  dhan_security_id?: string | null;
  groww_exchange?: string | null;
  groww_segment?: string | null;
  groww_trading_symbol?: string | null;
  indmoney_scrip_code?: string | null;
  kotak_query?: string | null;
  kotak_segment?: string | null;
  kotak_psymbol?: string | null;
}

export interface AlertTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  workflow_dsl: AlertWorkflowDsl;
  graph_dsl: AlertGraphDsl;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertWorkflow {
  id: string;
  user_id: string;
  template_id?: string | null;
  account_id?: string | null;
  broker_code?: string | null;
  name: string;
  description: string;
  symbol?: string | null;
  exchange?: string | null;
  instrument_ref: InstrumentRef;
  workflow_dsl: AlertWorkflowDsl;
  graph_dsl: AlertGraphDsl;
  editor_mode: EditorMode;
  status: WorkflowStatus;
  channel_override?: AlertChannelSelection | null;
  deployment_status?: string;
  deploy_version?: number;
  compiled_summary?: Record<string, unknown>;
  last_validated_at?: string | null;
  last_compiled_at?: string | null;
  last_runtime_error?: string | null;
  last_triggered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertWorkflowRun {
  id: string;
  workflow_id: string;
  notification_id?: string | null;
  matched: boolean;
  reason: string;
  rendered_title: string;
  rendered_message: string;
  channels: string[];
  tick: Record<string, unknown>;
  evaluation_payload: Record<string, unknown>;
  created_at: string;
}

export interface AlertNotification {
  id: string;
  user_id: string;
  workflow_id?: string | null;
  template_id?: string | null;
  account_id?: string | null;
  broker_code?: string | null;
  symbol?: string | null;
  exchange?: string | null;
  level: string;
  title: string;
  message: string;
  status: string;
  channels: string[];
  payload: Record<string, unknown>;
  dedupe_key?: string | null;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
}

export interface AlertUnreadCount {
  unread_count: number;
}

export interface AlertChannel {
  id: string;
  channel_type: AlertChannelType;
  label: string;
  is_enabled: boolean;
  is_default: boolean;
  config: Record<string, unknown>;
  last_tested_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LiveSubscription {
  id: string;
  user_id: string;
  workflow_id?: string | null;
  account_id?: string | null;
  broker_code?: string | null;
  symbol: string;
  exchange?: string | null;
  instrument_ref: InstrumentRef;
  source_kind: string;
  source_type?: string | null;
  source_id?: string | null;
  source_label?: string | null;
  owner_kind?: string | null;
  owner_id?: string | null;
  status: string;
  last_quote: Record<string, unknown>;
  last_received_at?: string | null;
  reconciled_at?: string | null;
  health_status?: string;
  health_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface LiveWorkerSession {
  broker_code: string;
  account_id: string;
  user_id: string;
  adapter: string;
  connected: boolean;
  connection_id?: string | null;
  connection_index: number;
  symbol_count: number;
  capacity: number;
  symbols: string[];
  last_seen_at?: string | null;
}

export interface LiveBrokerAccountStatus {
  broker_code: string;
  account_id: string;
  label: string;
  session_status?: string | null;
  session_active: boolean;
  can_stream: boolean;
  action_required: boolean;
  automation_enabled: boolean;
  automation_mode?: string | null;
  has_access_token: boolean;
  token_expires_at?: string | null;
  desired_symbol_count: number;
  active_worker_sessions: number;
  last_verified_at?: string | null;
  last_error?: string | null;
  guidance?: string | null;
}

export interface LiveStreamsStatus {
  redis_ok: boolean;
  redis_error: string;
  worker_mode: string;
  active_sessions: LiveWorkerSession[];
  desired_subscriptions: LiveSubscription[];
  broker_statuses: LiveBrokerAccountStatus[];
}

export interface AlertWorkflowValidation {
  valid: boolean;
  errors: string[];
  workflow_ast?: Record<string, unknown> | null;
  compiled_summary: Record<string, unknown>;
}

export interface AlertConditionRegistryField {
  name: string;
  type: string;
  description: string;
}

export interface AlertConditionRegistryOperator {
  operator: string;
  label: string;
  description: string;
  family: string;
  fields: string[];
}

export interface AlertConditionRegistryFunction {
  name: string;
  description: string;
}

export interface AlertConditionRegistry {
  fields: AlertConditionRegistryField[];
  operators: AlertConditionRegistryOperator[];
  functions: AlertConditionRegistryFunction[];
}

export interface AlertUniversePreview {
  count: number;
  sample: Array<Record<string, unknown>>;
}

export interface AlertReconcileReport {
  user_id?: string | null;
  users?: number | null;
  created: number;
  restored: number;
  updated: number;
  deactivated: number;
  orphaned: number;
  errors: number;
  desired: number;
  ran_at?: string | null;
  reports: Array<Record<string, unknown>>;
}
