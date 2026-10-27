// Child processes of the check scripts (check:yg, perf).

import { spawn, type ChildProcess } from 'node:child_process';

export function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  return spawn([cmd, ...args].join(' '), { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Stops a process with its children (on Windows the shell alone would die, the proxy would stay). */
export function stop(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid !== undefined) {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill();
  }
}

export async function waitFor(proc: ChildProcess, text: string, ms: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${text}" in ${String(ms)} ms`)), ms);
    const on = (chunk: Buffer): void => {
      if (chunk.toString().includes(text)) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on('data', on);
    proc.stderr?.on('data', on);
  });
}
