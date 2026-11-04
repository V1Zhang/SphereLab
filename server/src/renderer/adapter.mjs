import fs from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

function id() {
  return crypto.randomUUID();
}

function writeJson(child, message) {
  if (!child || child.killed || !child.stdin.writable) return false;
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return true;
}

/**
 * Host adapter for the native Linux/NVIDIA renderer.
 *
 * The renderer is deliberately a separate process. It receives JSONL commands
 * on stdin and emits JSONL events on stdout. This keeps CUDA/EGL/WebRTC code
 * out of the Node control plane and lets the same server be tested without a
 * GPU renderer binary installed.
 */
export class RendererAdapter {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  status() {
    const renderer = this.config.renderer || {};
    const command = renderer.command || null;
    let executable = false;
    if (command) {
      try {
        executable = fs.statSync(command).isFile() && Boolean(fs.accessSync(command, fs.constants.X_OK) === undefined);
      } catch {
        executable = false;
      }
    }
    return {
      configured: Boolean(command),
      executable,
      command,
      output: {
        width: Number(renderer.width || 3840),
        height: Number(renderer.height || 2160),
        fps: Number(renderer.fps || 30),
      },
      backend: "native-linux-nvidia-adapter",
      activeSessions: this.sessions.size,
    };
  }

  createSession(request) {
    const status = this.status();
    if (!status.executable) {
      const error = new Error("native renderer executable is not installed or not executable");
      error.code = "renderer_adapter_unavailable";
      throw error;
    }

    const sessionId = id();
    const renderer = this.config.renderer || {};
    const child = spawn(renderer.command, Array.isArray(renderer.args) ? renderer.args : [], {
      cwd: renderer.cwd || undefined,
      env: { ...process.env, ...(renderer.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = {
      id: sessionId,
      state: "starting",
      createdAt: new Date().toISOString(),
      request,
      child,
      events: [],
      offer: null,
      error: null,
    };
    this.sessions.set(sessionId, session);

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      let newline;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        try {
          this.#event(session, JSON.parse(line));
        } catch {
          this.#event(session, { type: "log", stream: "stdout", message: line });
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      this.#event(session, { type: "log", stream: "stderr", message: chunk.toString().trim() });
    });
    child.on("error", (error) => {
      session.state = "error";
      session.error = error.message;
      this.#event(session, { type: "error", message: error.message });
    });
    child.on("close", (code, signal) => {
      if (session.state !== "stopped" && session.state !== "error") session.state = code === 0 ? "stopped" : "error";
      this.#event(session, { type: "stopped", code, signal });
    });

    writeJson(child, {
      type: "start",
      sessionId,
      source: request.source || this.config.media?.source || null,
      manifest: request.manifest || this.config.media?.manifest || null,
      venue: request.venue || null,
      output: status.output,
      webrtc: this.config.webrtc || {},
    });
    return this.publicSession(session);
  }

  signal(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = new Error("render session not found");
      error.code = "render_session_not_found";
      throw error;
    }
    if (!writeJson(session.child, { type: "signal", ...message })) {
      const error = new Error("render session is not writable");
      error.code = "render_session_not_writable";
      throw error;
    }
    return this.publicSession(session);
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.publicSession(session);
  }

  stop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.state = "stopped";
    session.child.kill("SIGTERM");
    this.sessions.delete(sessionId);
    return true;
  }

  #event(session, event) {
    if (event.type === "ready") session.state = "ready";
    if (event.type === "offer") session.offer = event;
    session.events.push({ at: new Date().toISOString(), ...event });
    if (session.events.length > 100) session.events.shift();
  }

  publicSession(session) {
    return {
      id: session.id,
      state: session.state,
      createdAt: session.createdAt,
      offer: session.offer,
      error: session.error,
      events: session.events,
    };
  }
}
