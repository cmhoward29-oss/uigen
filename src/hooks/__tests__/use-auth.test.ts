import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";

// Mock dependencies
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

import { signIn as signInAction, signUp as signUpAction } from "@/actions";
import { getAnonWorkData, clearAnonWork } from "@/lib/anon-work-tracker";
import { getProjects } from "@/actions/get-projects";
import { createProject } from "@/actions/create-project";

const mockSignInAction = vi.mocked(signInAction);
const mockSignUpAction = vi.mocked(signUpAction);
const mockGetAnonWorkData = vi.mocked(getAnonWorkData);
const mockClearAnonWork = vi.mocked(clearAnonWork);
const mockGetProjects = vi.mocked(getProjects);
const mockCreateProject = vi.mocked(createProject);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" } as never);
});

// ─── signIn ───────────────────────────────────────────────────────────────────

describe("signIn", () => {
  describe("happy paths", () => {
    test("returns success result from server action", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "proj-1" }] as never);

      const { result } = renderHook(() => useAuth());
      let returned: unknown;
      await act(async () => {
        returned = await result.current.signIn("user@example.com", "password123");
      });

      expect(returned).toEqual({ success: true });
      expect(mockSignInAction).toHaveBeenCalledWith("user@example.com", "password123");
    });

    test("redirects to existing project after sign in", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "proj-1" }, { id: "proj-2" }] as never);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/proj-1");
    });

    test("creates a new project and redirects when no projects exist", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ id: "brand-new" } as never);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123");
      });

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [], data: {} })
      );
      expect(mockPush).toHaveBeenCalledWith("/brand-new");
    });

    test("migrates anonymous work into a new project and redirects", async () => {
      const anonWork = {
        messages: [{ role: "user", content: "hello" }],
        fileSystemData: { "index.tsx": "export default () => <div />" },
      };
      mockGetAnonWorkData.mockReturnValue(anonWork as never);
      mockSignInAction.mockResolvedValue({ success: true });
      mockCreateProject.mockResolvedValue({ id: "migrated-proj" } as never);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123");
      });

      expect(mockCreateProject).toHaveBeenCalledWith({
        name: expect.stringContaining("Design from"),
        messages: anonWork.messages,
        data: anonWork.fileSystemData,
      });
      expect(mockClearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/migrated-proj");
      // Should not also fetch existing projects
      expect(mockGetProjects).not.toHaveBeenCalled();
    });

    test("sets isLoading to true during sign in, then false after", async () => {
      let resolveAction!: (v: unknown) => void;
      mockSignInAction.mockReturnValue(new Promise((r) => (resolveAction = r)) as never);
      mockGetProjects.mockResolvedValue([{ id: "p1" }] as never);

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.signIn("user@example.com", "password123");
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveAction({ success: true });
      });
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("error states", () => {
    test("returns failure result without redirecting", async () => {
      mockSignInAction.mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());
      let returned: unknown;
      await act(async () => {
        returned = await result.current.signIn("user@example.com", "wrong");
      });

      expect(returned).toEqual({ success: false, error: "Invalid credentials" });
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("resets isLoading to false even when server action throws", async () => {
      mockSignInAction.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("resets isLoading to false when post-sign-in navigation throws", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockRejectedValue(new Error("DB error"));

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("ignores anonymous work with empty messages array", async () => {
      mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} } as never);
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "existing" }] as never);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("user@example.com", "password123");
      });

      // Should fall through to existing projects, not create anon migration
      expect(mockClearAnonWork).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/existing");
    });
  });
});

// ─── signUp ───────────────────────────────────────────────────────────────────

describe("signUp", () => {
  describe("happy paths", () => {
    test("returns success result from server action", async () => {
      mockSignUpAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "proj-1" }] as never);

      const { result } = renderHook(() => useAuth());
      let returned: unknown;
      await act(async () => {
        returned = await result.current.signUp("new@example.com", "password123");
      });

      expect(returned).toEqual({ success: true });
      expect(mockSignUpAction).toHaveBeenCalledWith("new@example.com", "password123");
    });

    test("runs handlePostSignIn after successful sign up", async () => {
      mockSignUpAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "proj-1" }] as never);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signUp("new@example.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/proj-1");
    });

    test("sets isLoading to true during sign up, then false after", async () => {
      let resolveAction!: (v: unknown) => void;
      mockSignUpAction.mockReturnValue(new Promise((r) => (resolveAction = r)) as never);
      mockGetProjects.mockResolvedValue([{ id: "p1" }] as never);

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.signUp("new@example.com", "password123");
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveAction({ success: true });
      });
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("error states", () => {
    test("returns failure result without redirecting", async () => {
      mockSignUpAction.mockResolvedValue({ success: false, error: "Email already in use" });

      const { result } = renderHook(() => useAuth());
      let returned: unknown;
      await act(async () => {
        returned = await result.current.signUp("taken@example.com", "password123");
      });

      expect(returned).toEqual({ success: false, error: "Email already in use" });
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("resets isLoading to false even when server action throws", async () => {
      mockSignUpAction.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signUp("new@example.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});

// ─── initial state ─────────────────────────────────────────────────────────────

describe("initial state", () => {
  test("isLoading starts as false", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(false);
  });

  test("exposes signIn, signUp, and isLoading", () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
    expect(typeof result.current.isLoading).toBe("boolean");
  });
});
