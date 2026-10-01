export type Id = string;
export type ISOTime = string;
export type Role = 'admin' | 'owner' | 'technician' | 'worker' | 'maintainer' | 'expert';
export type Action = 'read' | 'record' | 'claim' | 'close_alert' | 'review' | 'dispatch' | 'share' | 'configure' | 'export' | 'act';
export type ClaimPurpose = 'field_check' | 'repair';

export interface Actor { id: Id; role: Role; enabled: boolean; mfaVerified: boolean }
export interface Scope { objectId: Id; action: Action; at: ISOTime }
export interface Clock { now(): Date }
export interface ApiError { code: string; message: string; requestId: string }
export interface EvidenceRef { kind: 'reading' | 'raw' | 'record' | 'file'; id: Id }
export interface DomainEvent {
  id: Id;
  type: string;
  version: 1;
  objectId: Id;
  occurredAt: ISOTime;
  recordedAt: ISOTime;
  payload: Record<string, unknown>;
}
