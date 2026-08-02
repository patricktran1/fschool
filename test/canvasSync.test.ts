import { describe, it, expect, vi } from "vitest";

// canvasSync imports the browser supabase client (src/api/supabase.ts), which calls
// createClient(import.meta.env.VITE_…) at load — undefined in tests → throws. Stub it.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { buildApiBase } from "../src/api/canvasSync";

describe("buildApiBase", () => {
  it("adds https:// when no scheme is present", () => {
    expect(buildApiBase("school.instructure.com")).toBe("https://school.instructure.com/api/v1");
  });

  it("preserves an existing scheme", () => {
    expect(buildApiBase("http://localhost:3000")).toBe("http://localhost:3000/api/v1");
  });

  it("appends /api/v1 and strips trailing slashes", () => {
    expect(buildApiBase("https://x.instructure.com/")).toBe("https://x.instructure.com/api/v1");
    expect(buildApiBase("https://x.instructure.com///")).toBe("https://x.instructure.com/api/v1");
  });

  it("does not double /api/v1 if already present", () => {
    expect(buildApiBase("https://x.instructure.com/api/v1")).toBe("https://x.instructure.com/api/v1");
  });

  it("trims surrounding whitespace", () => {
    expect(buildApiBase("  x.instructure.com  ")).toBe("https://x.instructure.com/api/v1");
  });
});
