import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, wb } from "../helpers";

describe("help (no args)", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("shows help text and exits with code 1", async () => {
    env = await createTempRepo();
    const result = await wb(env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("stanok start");
    expect(result.stdout).toContain("stanok ls");
    expect(result.stdout).toContain("stanok stop");
  });
});
