import { randomBytes } from "crypto";

export type JobStatus = "pending" | "done" | "error";

export interface Job {
  id: string;
  sessionId: string;
  startedAt: string;
  status: JobStatus;
  completedAt?: string;
  result?: string;
  error?: string;
}

const jobs = new Map<string, Job>();

export function createJob(sessionId: string): Job {
  const id = `job_${randomBytes(4).toString("hex")}`;
  const job: Job = {
    id,
    sessionId,
    startedAt: new Date().toISOString(),
    status: "pending",
  };

  jobs.set(id, job);

  return job;
}

export function resolveJob(id: string, result: string): void {
  const job = jobs.get(id);

  if (!job) return;

  job.status = "done";
  job.completedAt = new Date().toISOString();
  job.result = result;
}

export function rejectJob(id: string, error: string): void {
  const job = jobs.get(id);

  if (!job) return;

  job.status = "error";
  job.completedAt = new Date().toISOString();
  job.error = error;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}
