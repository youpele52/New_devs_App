import { describe, expect, it, vi, afterEach } from "vitest";

const loadApiBase = async () => {
  vi.resetModules();
  return import("./apiBase");
};

describe("getApiBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "http://localhost:3000/");
  });

  it("prefers VITE_BACKEND_URL when present", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://backend.example");
    vi.stubEnv("VITE_API_URL", "http://api.example");

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe("http://backend.example");
  });

  it("falls back to VITE_API_URL when VITE_BACKEND_URL is missing", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:8000");

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe("http://localhost:8000");
  });

  it("defaults to localhost backend in local development when no env is set", async () => {
    window.history.replaceState({}, "", "http://localhost:3000/profile");

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe("http://localhost:8000");
  });
});
