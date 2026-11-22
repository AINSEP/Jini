/** Host-neutral storage retention: a serialized pass runner over injected policies, and a read-only
 * tree measurement. Hosts own every path and every policy; nothing in this entry deletes files. */
export {
  RETENTION_DEFAULT_INTERVAL_MS,
  createRetentionRunner,
  type RetentionMeasurement,
  type RetentionPassResult,
  type RetentionPolicy,
  type RetentionPolicyKind,
  type RetentionPolicyOutcome,
  type RetentionRunner,
  type RetentionRunnerOptional,
  type RetentionRunnerRequired,
  type RetentionScheduler,
  type RetentionSweepResult,
} from './runner.js';
export {
  measureStorageTree,
  type StorageTally,
  type StorageTarget,
  type StorageTreeFs,
  type StorageTreeMeasurement,
  type StorageTreeStats,
} from './measure-tree.js';
