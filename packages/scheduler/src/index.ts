export type JobTrigger =
  | { readonly type: 'once'; readonly runAt: string }
  | { readonly type: 'interval'; readonly everyMilliseconds: number };

export interface ScheduledJob {
  readonly id: string;
  readonly name: string;
  readonly trigger: JobTrigger;
  run(signal: AbortSignal): Promise<void>;
}

/** Scheduling port only; production cron and queue infrastructure are out of scope. */
export interface Scheduler {
  schedule(job: ScheduledJob): Promise<void>;
  cancel(jobId: string): Promise<boolean>;
}
