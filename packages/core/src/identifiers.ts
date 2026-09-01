import { z } from 'zod';

declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type LeagueId = Brand<string, 'LeagueId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type RosterSlotId = Brand<string, 'RosterSlotId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type ActionId = Brand<string, 'ActionId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type JobId = Brand<string, 'JobId'>;
export type SnapshotId = Brand<string, 'SnapshotId'>;

const opaqueIdSchema = z.string().trim().min(1, 'Identifier cannot be empty');

function parseId<Name extends string>(value: unknown): Brand<string, Name> {
  return opaqueIdSchema.parse(value) as Brand<string, Name>;
}

export const leagueId = (value: unknown): LeagueId =>
  parseId<'LeagueId'>(value);
export const teamId = (value: unknown): TeamId => parseId<'TeamId'>(value);
export const playerId = (value: unknown): PlayerId =>
  parseId<'PlayerId'>(value);
export const rosterSlotId = (value: unknown): RosterSlotId =>
  parseId<'RosterSlotId'>(value);
export const decisionId = (value: unknown): DecisionId =>
  parseId<'DecisionId'>(value);
export const actionId = (value: unknown): ActionId =>
  parseId<'ActionId'>(value);
export const transactionId = (value: unknown): TransactionId =>
  parseId<'TransactionId'>(value);
export const jobId = (value: unknown): JobId => parseId<'JobId'>(value);
export const snapshotId = (value: unknown): SnapshotId =>
  parseId<'SnapshotId'>(value);

/** An identifier owned by an external platform, kept distinct from EggBot IDs. */
export interface PlatformReference {
  readonly provider: string;
  readonly value: string;
}
