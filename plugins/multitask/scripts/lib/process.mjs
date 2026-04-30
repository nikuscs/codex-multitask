import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code, signal) =>
      resolve({ code: code ?? 0, signal, stdout, stderr, pid: child.pid ?? null }),
    );
    child.on("error", (error) =>
      resolve({ code: 1, signal: null, stdout, stderr: String(error), pid: child.pid ?? null }),
    );
  });
}

export function spawnStreaming(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    detached: Boolean(options.detached),
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (options.detached) child.unref();
  return child;
}

export async function appendLog(file, text) {
  await fs.appendFile(file, text, "utf8");
}

export function isProcessRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function terminateProcessTree(pid, signal = "SIGTERM") {
  if (!pid) return false;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return true;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
