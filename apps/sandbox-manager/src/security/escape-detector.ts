import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:escape-detector");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViolationSeverity = "low" | "medium" | "high" | "critical";

export interface Violation {
  description: string;
  details?: Record<string, unknown>;
  severity: ViolationSeverity;
  timestamp: string;
  type: string;
}

export interface MonitorState {
  isMonitoring: boolean;
  sandboxId: string;
  startedAt: string;
  violations: Violation[];
}

// ─── Blocked Syscalls ────────────────────────────────────────────────────────

/** Dangerous syscalls that should be blocked via seccomp */
export const BLOCKED_SYSCALLS = [
  "ptrace",
  "mount",
  "umount2",
  "kexec_load",
  "kexec_file_load",
  "init_module",
  "finit_module",
  "delete_module",
  "reboot",
  "swapon",
  "swapoff",
  "pivot_root",
  "chroot",
  "acct",
  "settimeofday",
  "clock_settime",
  "stime",
  "ioperm",
  "iopl",
  "create_module",
  "query_module",
  "nfsservctl",
  "personality",
  "keyctl",
  "request_key",
  "add_key",
  "unshare",
  "setns",
  "userfaultfd",
  "perf_event_open",
  "bpf",
  "lookup_dcookie",
  "move_pages",
  "mbind",
  "set_mempolicy",
  "get_mempolicy",
] as const;

// ─── Detection Patterns ───────────────────────────────────────────────────────

interface DetectionRule {
  description: string;
  name: string;
  pattern: RegExp;
  severity: ViolationSeverity;
}

const ESCAPE_PATTERNS: DetectionRule[] = [
  // Docker socket access
  {
    name: "docker_socket_access",
    pattern: /\/var\/run\/docker\.sock/,
    severity: "critical",
    description: "Attempted access to Docker socket",
  },
  // Network scanning
  {
    name: "network_scan_nmap",
    pattern: /\bnmap\b/,
    severity: "high",
    description: "Network scanning tool (nmap) detected",
  },
  {
    name: "network_scan_masscan",
    pattern: /\bmasscan\b/,
    severity: "high",
    description: "Network scanning tool (masscan) detected",
  },
  // Privilege escalation
  {
    name: "privilege_escalation_sudo",
    pattern: /\bsudo\b/,
    severity: "high",
    description: "Privilege escalation attempt (sudo)",
  },
  {
    name: "privilege_escalation_su",
    pattern: /\bsu\s+-?\s*\w*/,
    severity: "high",
    description: "Privilege escalation attempt (su)",
  },
  {
    name: "privilege_escalation_setuid",
    pattern: /chmod\s+[0-7]*[4-7][0-7]{2}/,
    severity: "high",
    description: "SetUID bit manipulation detected",
  },
  // Container escape attempts
  {
    name: "proc_escape",
    pattern: /\/proc\/\d+\/root/,
    severity: "critical",
    description: "Attempted access to host filesystem via /proc",
  },
  {
    name: "cgroup_escape",
    pattern: /\/sys\/fs\/cgroup/,
    severity: "critical",
    description: "Attempted cgroup manipulation",
  },
  {
    name: "mount_namespace",
    pattern: /\bnsenter\b/,
    severity: "critical",
    description: "Namespace escape attempt (nsenter)",
  },
  // Sensitive file access
  {
    name: "etc_shadow",
    pattern: /\/etc\/shadow/,
    severity: "high",
    description: "Attempted read of /etc/shadow",
  },
  {
    name: "etc_passwd_write",
    pattern: />\s*\/etc\/passwd/,
    severity: "critical",
    description: "Attempted write to /etc/passwd",
  },
  {
    name: "ssh_keys",
    pattern: /\/\.ssh\/(id_rsa|authorized_keys)/,
    severity: "high",
    description: "Attempted access to SSH keys",
  },
  // Crypto mining
  {
    name: "crypto_mining",
    pattern: /\b(xmrig|minerd|stratum\+tcp)\b/i,
    severity: "critical",
    description: "Crypto mining activity detected",
  },
  // Reverse shell
  {
    name: "reverse_shell",
    pattern: /\b(nc|ncat|netcat)\s+.*-e\s+(\/bin\/)?(sh|bash)/,
    severity: "critical",
    description: "Reverse shell attempt detected",
  },
  {
    name: "reverse_shell_bash",
    pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp/,
    severity: "critical",
    description: "Bash reverse shell attempt detected",
  },
  // Base64 payload piped to shell
  {
    name: "base64_pipe_to_shell",
    pattern: /base64\s+(-d|--decode)\s*\|.*\b(sh|bash|zsh)\b/,
    severity: "critical",
    description: "Base64-encoded payload piped to shell",
  },
  // curl/wget piped to shell
  {
    name: "curl_pipe_to_shell",
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|sudo\s+(sh|bash))\b/,
    severity: "critical",
    description: "Remote script execution via curl/wget pipe to shell",
  },
  // Docker socket mount/access via docker commands
  {
    name: "docker_socket_mount",
    pattern: /docker\s+(run|exec|create)\b.*docker\.sock/,
    severity: "critical",
    description: "Docker command accessing docker.sock",
  },
];

// ─── File Write Detection Patterns ───────────────────────────────────────────

interface FileWriteRule {
  description: string;
  name: string;
  pathPattern: RegExp;
  severity: ViolationSeverity;
}

const FILE_WRITE_PATTERNS: FileWriteRule[] = [
  {
    name: "crontab_write",
    pathPattern: /\/(etc\/cron|var\/spool\/cron)/,
    severity: "high",
    description: "Write to crontab or cron directory",
  },
  {
    name: "init_write",
    pathPattern: /\/(etc\/init\.d|etc\/systemd|lib\/systemd)/,
    severity: "critical",
    description: "Write to system init/service directory",
  },
  {
    name: "ssh_write",
    pathPattern: /\/\.ssh\/(authorized_keys|id_rsa|config)/,
    severity: "critical",
    description: "Write to SSH configuration or keys",
  },
  {
    name: "etc_passwd_write",
    pathPattern: /\/etc\/(passwd|shadow|sudoers)/,
    severity: "critical",
    description: "Write to system auth files",
  },
  {
    name: "docker_socket_write",
    pathPattern: /\/var\/run\/docker\.sock/,
    severity: "critical",
    description: "Write access to Docker socket",
  },
  {
    name: "proc_sys_write",
    pathPattern: /\/proc\/sys\//,
    severity: "critical",
    description: "Write to /proc/sys kernel parameters",
  },
];

// ─── Seccomp Profile Recommendations ──────────────────────────────────────────

export const RECOMMENDED_SECCOMP = {
  defaultAction: "SCMP_ACT_ERRNO",
  architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  syscalls: [
    {
      names: [
        "read",
        "write",
        "open",
        "close",
        "stat",
        "fstat",
        "lstat",
        "poll",
        "lseek",
        "mmap",
        "mprotect",
        "munmap",
        "brk",
        "rt_sigaction",
        "rt_sigprocmask",
        "ioctl",
        "access",
        "pipe",
        "select",
        "sched_yield",
        "mremap",
        "msync",
        "mincore",
        "madvise",
        "dup",
        "dup2",
        "pause",
        "nanosleep",
        "getpid",
        "socket",
        "connect",
        "accept",
        "sendto",
        "recvfrom",
        "bind",
        "listen",
        "getsockname",
        "getpeername",
        "socketpair",
        "clone",
        "fork",
        "vfork",
        "execve",
        "exit",
        "wait4",
        "kill",
        "uname",
        "fcntl",
        "flock",
        "fsync",
        "fdatasync",
        "truncate",
        "ftruncate",
        "getdents",
        "getcwd",
        "chdir",
        "rename",
        "mkdir",
        "rmdir",
        "link",
        "unlink",
        "symlink",
        "readlink",
        "chmod",
        "chown",
        "umask",
        "gettimeofday",
        "getrlimit",
        "getrusage",
        "sysinfo",
        "times",
        "getuid",
        "getgid",
        "geteuid",
        "getegid",
        "getppid",
        "getpgrp",
        "setsid",
        "setpgid",
        "getgroups",
        "setgroups",
        "sigaltstack",
        "arch_prctl",
        "prctl",
        "futex",
        "set_tid_address",
        "set_robust_list",
        "clock_gettime",
        "epoll_create",
        "epoll_ctl",
        "epoll_wait",
        "openat",
        "newfstatat",
        "readlinkat",
        "getrandom",
        "pipe2",
        "eventfd2",
        "epoll_create1",
      ],
      action: "SCMP_ACT_ALLOW",
    },
  ],
};

// ─── Escape Detector ──────────────────────────────────────────────────────────

export class EscapeDetector {
  private readonly monitors = new Map<string, MonitorState>();

  /**
   * Start monitoring a sandbox for escape attempts.
   */
  monitor(sandboxId: string): void {
    if (this.monitors.has(sandboxId)) {
      return;
    }

    this.monitors.set(sandboxId, {
      sandboxId,
      violations: [],
      isMonitoring: true,
      startedAt: new Date().toISOString(),
    });

    logger.info({ sandboxId }, "Started escape detection monitoring");
  }

  /**
   * Stop monitoring a sandbox.
   */
  stopMonitoring(sandboxId: string): void {
    const state = this.monitors.get(sandboxId);
    if (state) {
      state.isMonitoring = false;
      logger.info(
        { sandboxId, violationCount: state.violations.length },
        "Stopped escape detection monitoring"
      );
    }
  }

  /**
   * Check a command or file access for violations.
   */
  checkViolations(sandboxId: string, input?: string): Violation[] {
    const state = this.monitors.get(sandboxId);
    if (!state?.isMonitoring) {
      return [];
    }

    if (!input) {
      return state.violations;
    }

    const newViolations: Violation[] = [];

    for (const rule of ESCAPE_PATTERNS) {
      if (rule.pattern.test(input)) {
        const violation: Violation = {
          type: rule.name,
          severity: rule.severity,
          description: rule.description,
          timestamp: new Date().toISOString(),
          details: { input: input.slice(0, 200) },
        };

        newViolations.push(violation);
        state.violations.push(violation);

        logger.warn(
          {
            sandboxId,
            violationType: rule.name,
            severity: rule.severity,
          },
          `Sandbox escape attempt detected: ${rule.description}`
        );
      }
    }

    return newViolations;
  }

  /**
   * Check a single command for escape patterns before execution.
   * Returns null if safe, or a Violation if dangerous.
   */
  checkCommand(sandboxId: string, command: string): Violation | null {
    const state = this.monitors.get(sandboxId);
    if (!state?.isMonitoring) {
      return null;
    }

    for (const rule of ESCAPE_PATTERNS) {
      if (rule.pattern.test(command)) {
        const violation: Violation = {
          type: rule.name,
          severity: rule.severity,
          description: rule.description,
          timestamp: new Date().toISOString(),
          details: { command: command.slice(0, 200) },
        };

        state.violations.push(violation);

        logger.warn(
          {
            sandboxId,
            violationType: rule.name,
            severity: rule.severity,
            command: command.slice(0, 100),
          },
          `Command blocked: ${rule.description}`
        );

        return violation;
      }
    }

    return null;
  }

  /**
   * Check a file write operation for suspicious paths.
   * Returns null if safe, or a Violation if the target path is dangerous.
   */
  checkFileWrite(
    sandboxId: string,
    filePath: string,
    content?: string
  ): Violation | null {
    const state = this.monitors.get(sandboxId);
    if (!state?.isMonitoring) {
      return null;
    }

    // Check file path against write patterns
    for (const rule of FILE_WRITE_PATTERNS) {
      if (rule.pathPattern.test(filePath)) {
        const violation: Violation = {
          type: rule.name,
          severity: rule.severity,
          description: rule.description,
          timestamp: new Date().toISOString(),
          details: { filePath, contentPreview: content?.slice(0, 100) },
        };

        state.violations.push(violation);

        logger.warn(
          {
            sandboxId,
            violationType: rule.name,
            severity: rule.severity,
            filePath,
          },
          `File write blocked: ${rule.description}`
        );

        return violation;
      }
    }

    // Also check file content against escape patterns if provided
    if (content) {
      for (const rule of ESCAPE_PATTERNS) {
        if (rule.pattern.test(content)) {
          const violation: Violation = {
            type: `file_content_${rule.name}`,
            severity: rule.severity,
            description: `Suspicious file content: ${rule.description}`,
            timestamp: new Date().toISOString(),
            details: {
              filePath,
              contentPreview: content.slice(0, 100),
            },
          };

          state.violations.push(violation);

          logger.warn(
            {
              sandboxId,
              violationType: rule.name,
              severity: rule.severity,
              filePath,
            },
            `Suspicious file content detected: ${rule.description}`
          );

          return violation;
        }
      }
    }

    return null;
  }

  /**
   * Get all recorded violations for a sandbox.
   */
  getViolations(sandboxId: string): Violation[] {
    return this.monitors.get(sandboxId)?.violations ?? [];
  }

  /**
   * Check if a sandbox should be terminated due to critical violations.
   */
  shouldTerminate(sandboxId: string): boolean {
    const violations = this.getViolations(sandboxId);
    return violations.some((v) => v.severity === "critical");
  }
}
