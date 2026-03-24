import { execFileUtf8 } from "../../daemon/exec-file.js";

export interface ShellRunRequest {
  cwd: string;
  command: string;
}

export interface ShellRunResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface ShellRunner {
  run(request: ShellRunRequest): Promise<ShellRunResult>;
}

export class HostShellRunner implements ShellRunner {
  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    const result = await execFileUtf8("bash", ["-lc", request.command], {
      cwd: request.cwd
    });
    return {
      command: request.command,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
