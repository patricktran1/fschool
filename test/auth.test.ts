import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the browser Supabase client so auth.ts talks to a fake GoTrue + query builder.
const h = vi.hoisted(() => {
  const auth = { signInWithPassword: vi.fn(), getSession: vi.fn(), signOut: vi.fn() };
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn();
  const from = vi.fn(() => builder);
  return { auth, builder, from };
});
vi.mock("../src/api/supabase", () => ({ supabase: { auth: h.auth, from: h.from } }));

import { signIn, signUp, currentProfile } from "../src/api/auth";

const PROFILE = { id: "profile-1", name: "Ada", school: "MIT" };

beforeEach(() => {
  vi.clearAllMocks();
  h.from.mockReturnValue(h.builder);
  h.builder.select.mockReturnValue(h.builder);
  h.builder.eq.mockReturnValue(h.builder);
  h.builder.maybeSingle.mockResolvedValue({ data: PROFILE });
  h.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "auth-uuid-1" } } } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("signIn", () => {
  it("signs in directly via Supabase Auth and returns the profile (no migration)", async () => {
    h.auth.signInWithPassword.mockResolvedValue({ error: null });
    const p = await signIn("  Ada@MIT.edu ", "pw");
    expect(p).toEqual(PROFILE);
    expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(h.auth.signInWithPassword).toHaveBeenCalledWith({ email: "ada@mit.edu", password: "pw" }); // normalized
    expect(fetch).not.toHaveBeenCalled(); // no migrate needed
  });

  it("lazily migrates a legacy account, then retries and returns the profile", async () => {
    h.auth.signInWithPassword
      .mockResolvedValueOnce({ error: { message: "Invalid login credentials" } }) // not in GoTrue yet
      .mockResolvedValueOnce({ error: null });                                     // succeeds after migrate
    (fetch as any).mockResolvedValue({ ok: true });
    const p = await signIn("ada@mit.edu", "pw");
    expect(p).toEqual(PROFILE);
    expect(fetch).toHaveBeenCalledWith("/api/auth-migrate?action=migrate", expect.anything());
    expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it("throws on a wrong password (auth fails, migrate fails) without retrying", async () => {
    h.auth.signInWithPassword.mockResolvedValue({ error: { message: "Invalid" } });
    (fetch as any).mockResolvedValue({ ok: false }); // migrate rejects too
    await expect(signIn("ada@mit.edu", "nope")).rejects.toThrow("Incorrect email or password.");
    expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(1); // not retried after a failed migrate
  });
});

describe("signUp", () => {
  it("creates the account via the endpoint, signs in, and returns the new profile id", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ userId: "new-1", authId: "a-1" }) });
    h.auth.signInWithPassword.mockResolvedValue({ error: null });
    const p = await signUp({ name: "Ada", email: "Ada@MIT.edu", password: "pw" });
    expect(p).toEqual({ id: "new-1", name: "Ada" });
    expect(fetch).toHaveBeenCalledWith("/api/auth-migrate?action=signup", expect.anything());
    expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("surfaces a duplicate-email error and never signs in", async () => {
    (fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: "An account with this email already exists." }) });
    await expect(signUp({ name: "Ada", email: "ada@mit.edu", password: "pw" })).rejects.toThrow("already exists");
    expect(h.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("currentProfile", () => {
  it("returns null when there is no session", async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await currentProfile()).toBeNull();
  });
  it("maps the session to the users row via auth_id", async () => {
    expect(await currentProfile()).toEqual(PROFILE);
    expect(h.builder.eq).toHaveBeenCalledWith("auth_id", "auth-uuid-1");
  });
});
