import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { JobEvent, JobInfo, NewJobInput } from '@shared/types';

const MAX_OUTPUT_CHARS = 256 * 1024;

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(s.length - n);
}

export class JobRunner extends EventEmitter {
  private jobs = new Map<string, JobInfo>();
  private procs = new Map<string, ChildProcessWithoutNullStreams>();

  list(): JobInfo[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(jobId: string): JobInfo | null {
    return this.jobs.get(jobId) ?? null;
  }

  cancel(jobId: string): boolean {
    const p = this.procs.get(jobId);
    if (!p) return false;
    try {
      p.kill('SIGTERM');
      const job = this.jobs.get(jobId);
      if (job && (job.status === 'running' || job.status === 'starting')) {
        job.status = 'cancelled';
        job.finishedAt = Date.now();
        this.emit('updated', job);
      }
      return true;
    } catch {
      return false;
    }
  }

  start(input: NewJobInput): JobInfo {
    const jobId = randomUUID();
    const args: string[] = ['--print', '--output-format', 'text'];
    if (input.agent) args.push('--agent', input.agent);
    if (input.model) args.push('--model', input.model);
    if (input.name) args.push('--name', input.name);
    args.push(input.prompt);

    const job: JobInfo = {
      jobId,
      pid: null,
      prompt: input.prompt,
      cwd: input.cwd,
      agent: input.agent ?? null,
      model: input.model ?? null,
      name: input.name ?? null,
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      status: 'starting',
      output: '',
      errorOutput: ''
    };
    this.jobs.set(jobId, job);

    const onEvent = (e: JobEvent) => this.emit('event', e);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('claude', args, {
        cwd: input.cwd,
        shell: process.platform === 'win32',
        env: { ...process.env, FORCE_COLOR: '0' },
        windowsHide: true
      });
    } catch (err) {
      job.status = 'failed';
      job.finishedAt = Date.now();
      job.errorOutput = err instanceof Error ? err.message : String(err);
      onEvent({ jobId, type: 'error', data: job.errorOutput, ts: Date.now() });
      this.emit('updated', job);
      return job;
    }

    this.procs.set(jobId, child);
    job.pid = child.pid ?? null;
    job.status = 'running';
    onEvent({ jobId, type: 'spawn', data: `pid=${job.pid}`, ts: Date.now() });
    this.emit('updated', job);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      job.output = clip(job.output + chunk, MAX_OUTPUT_CHARS);
      onEvent({ jobId, type: 'stdout', data: chunk, ts: Date.now() });
    });
    child.stderr.on('data', (chunk: string) => {
      job.errorOutput = clip(job.errorOutput + chunk, MAX_OUTPUT_CHARS);
      onEvent({ jobId, type: 'stderr', data: chunk, ts: Date.now() });
    });
    child.on('error', (err) => {
      job.errorOutput = clip(job.errorOutput + '\n' + err.message, MAX_OUTPUT_CHARS);
      onEvent({ jobId, type: 'error', data: err.message, ts: Date.now() });
      if (job.status === 'starting' || job.status === 'running') {
        job.status = 'failed';
        job.finishedAt = Date.now();
        this.emit('updated', job);
      }
    });
    child.on('close', (code) => {
      job.exitCode = code;
      job.finishedAt = Date.now();
      if (job.status !== 'cancelled') {
        job.status = code === 0 ? 'completed' : 'failed';
      }
      this.procs.delete(jobId);
      onEvent({ jobId, type: 'exit', exitCode: code, ts: Date.now() });
      this.emit('updated', job);
    });

    return job;
  }

  disposeAll(): void {
    for (const jobId of Array.from(this.procs.keys())) this.cancel(jobId);
  }
}
