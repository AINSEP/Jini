const translate = (key: string) => key;
const port = { login: async () => ({ user: { id: "u", username: "operator" } }) };
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Login } from "../Login.js";
import type { LoginController } from "../hooks/use-login.hooks.js";

function stubHook(overrides: Partial<LoginController> = {}): () => LoginController {
  return () => ({
    username: "admin",
    setUsername: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    error: null,
    busy: false,
    submit: vi.fn((e) => {
      e.preventDefault();
      return Promise.resolve();
    }),
    ...overrides,
  });
}

describe("Login", () => {
  it("passes the onLogin prop straight through to useLoginHook, unmodified", () => {
    const onLogin = vi.fn();
    const useLoginHook = vi.fn(stubHook());
    render(<Login port={port} translate={translate} productName="Example" onLogin={onLogin} useLoginHook={useLoginHook} />);
    expect(useLoginHook).toHaveBeenCalledWith({ onLogin, port, translate }, { initialUsername: undefined });
  });

  it("renders the hook's username/password values in their inputs", () => {
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ username: "alice", password: "secret" })} />);
    expect(screen.getByLabelText(/username/i)).toHaveValue("alice");
    expect(screen.getByLabelText(/password/i)).toHaveValue("secret");
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("autocomplete", "current-password");
  });

  it("calls the hook's setUsername/setPassword as the operator types", async () => {
    const user = userEvent.setup();
    const setUsername = vi.fn();
    const setPassword = vi.fn();
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ username: "", password: "", setUsername, setPassword })} />);

    await user.type(screen.getByLabelText(/username/i), "x");
    await user.type(screen.getByLabelText(/password/i), "y");

    expect(setUsername).toHaveBeenCalledWith("x");
    expect(setPassword).toHaveBeenCalledWith("y");
  });

  it("shows no error banner when error is null", () => {
    const { container } = render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ error: null })} />);
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(container.querySelector(".login-error")).toBeNull();
  });

  it("shows the hook's error message verbatim when set", () => {
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ error: "invalid credentials" })} />);
    expect(screen.getByText("invalid credentials")).toBeInTheDocument();
  });

  it("disables the submit button and shows 'Signing in…' while busy", () => {
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ busy: true })} />);
    const button = screen.getByRole("button", { name: /signing in/i });
    expect(button).toBeDisabled();
  });

  it("enables the submit button and shows 'Sign in' when not busy", () => {
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ busy: false })} />);
    const button = screen.getByRole("button", { name: /^sign in$/i });
    expect(button).toBeEnabled();
  });

  it("calls the hook's submit when the form is submitted", async () => {
    const user = userEvent.setup();

    const submit = vi.fn(async (e: React.FormEvent) => {
      e.preventDefault();
    });
    render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={stubHook({ submit })} />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(submit).toHaveBeenCalledOnce();
  });
});
