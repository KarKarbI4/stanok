// ─── Auth helpers ────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface ServiceAuth {
  token: string;
}

export type AuthConfig = Record<string, ServiceAuth>;

function authPath(): string {
  return join(process.env.HOME!, ".stanok", "auth.json");
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readAuth(): AuthConfig {
  if (!existsSync(authPath())) return {};
  try {
    return JSON.parse(readFileSync(authPath(), "utf-8")) as AuthConfig;
  } catch {
    return {};
  }
}

export function getAuth(url: string): ServiceAuth | null {
  const auth = readAuth();
  const key = normalizeUrl(url);
  return auth[key] ?? auth[key + "/"] ?? null;
}

export function setAuth(url: string, service: ServiceAuth): void {
  const auth = readAuth();
  auth[normalizeUrl(url)] = service;
  writeFileSync(authPath(), JSON.stringify(auth, null, 2) + "\n");
}

export async function promptToken(label: string, url: string, hint?: string): Promise<string> {
  process.stdout.write(`Нужен токен для ${label} (${url}):\n`);
  if (hint) process.stdout.write(hint + "\n");
  process.stdout.write("Токен: ");
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);

  return new Promise<string>((resolve) => {
    let input = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.unref();
        process.stdout.write("\n");
        const existing = getAuth(url);
        setAuth(url, { ...existing, token: input });
        resolve(input);
      } else if (c === "\x7f" || c === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (c === "\x03") {
        process.exit(130);
      } else {
        input += c;
        process.stdout.write("•");
      }
    };
    stdin.on("data", onData);
  });
}

export async function requireAuth(url: string, label: string, hint?: string): Promise<ServiceAuth> {
  const existing = getAuth(url);
  if (existing?.token) return existing;
  const token = await promptToken(label, url, hint);
  return { token };
}

export async function withAuthRetry<C, R>(
  label: string,
  url: string,
  makeClient: (token: string) => C,
  action: (client: C) => Promise<R>,
  hint?: string,
): Promise<R> {
  let auth = getAuth(url);
  if (!auth?.token) {
    const token = await promptToken(label, url, hint);
    auth = { token };
  }
  try {
    return await action(makeClient(auth.token));
  } catch (e: any) {
    const isAuthError = e.status === 401 || e.status === 403
      || /invalid.*(header|value)/i.test(e.message);
    if (isAuthError) {
      const reason = e.status === 401
        ? "токен истёк или невалиден — создай новый PAT"
        : "у токена нет нужных прав";
      console.error(`→ ${label} (${url}): ${e.status} ${reason}`);
      const existing = getAuth(url);
      if (existing) setAuth(url, { ...existing, token: "" });
      const token = await promptToken(label, url, hint);
      return await action(makeClient(token));
    }
    throw e;
  }
}
