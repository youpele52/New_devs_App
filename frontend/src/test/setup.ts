import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// localStorage / sessionStorage — provide a reliable in-memory mock because
// jsdom's built-in localStorage can be unstable depending on the vitest pool
// configuration (--localstorage-file warning).
// ---------------------------------------------------------------------------

function makeMockStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
    _reset: () => {
      store = {};
    },
  };
}

const mockLocalStorage = makeMockStorage();
const mockSessionStorage = makeMockStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: mockSessionStorage,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Stub browser APIs that jsdom may not implement
// ---------------------------------------------------------------------------

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

(globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Clean slate before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLocalStorage._reset();
  mockSessionStorage._reset();
  vi.clearAllMocks();
  // Reset the global logout flag that AuthContext sets
  (globalThis as any).__isLoggingOut = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
