import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import { AiProvider } from "@/models/ai.model";

const getUserApiKeys = vi.fn();
const getDefaultOllamaBaseUrl = vi.fn();
const deleteApiKey = vi.fn();
const saveApiKey = vi.fn();
const getUserSettings = vi.fn();
const checkOllamaConnection = vi.fn();

vi.mock("@/actions/apiKey.actions", () => ({
  getUserApiKeys: () => getUserApiKeys(),
  saveApiKey: (input: unknown) => saveApiKey(input),
  deleteApiKey: (provider: string) => deleteApiKey(provider),
  getDefaultOllamaBaseUrl: () => getDefaultOllamaBaseUrl(),
}));

vi.mock("@/actions/userSettings.actions", () => ({
  getUserSettings: () => getUserSettings(),
}));

vi.mock("@/utils/ai.utils", () => ({
  checkOllamaConnection: (provider: AiProvider) =>
    checkOllamaConnection(provider),
}));

vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

function settingsFor(provider: AiProvider) {
  return {
    success: true,
    data: { userId: "u1", settings: { ai: { provider }, display: {} } },
  };
}

describe("ApiKeySettings — Ollama connection probe", () => {
  beforeEach(() => {
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    checkOllamaConnection.mockResolvedValue({ isConnected: true });
  });

  it("does not probe Ollama when another provider is selected", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));

    render(<ApiKeySettings />);

    await waitFor(() => expect(getUserSettings).toHaveBeenCalled());
    expect(checkOllamaConnection).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ollama is (not )?running/)).toBeNull();
  });

  it("probes Ollama when it is the selected provider", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OLLAMA));

    render(<ApiKeySettings />);

    await waitFor(() =>
      expect(screen.getByText("Ollama is running")).toBeInTheDocument(),
    );
    expect(checkOllamaConnection).toHaveBeenCalledWith(AiProvider.OLLAMA);
  });
});

describe("ApiKeySettings — clearing a stored base URL", () => {
  beforeEach(() => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [
        {
          id: "k1",
          provider: "ollama",
          last4: "http://box:11434",
          displayValue: "http://box:11434",
          label: null,
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ],
    });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));
    checkOllamaConnection.mockResolvedValue({ isConnected: false });
  });

  it("offers a labelled reset that names the server default", async () => {
    render(<ApiKeySettings />);

    await waitFor(() =>
      expect(screen.getByText("Reset to default")).toBeInTheDocument(),
    );
  });
});

describe("ApiKeySettings - USAJOBS credentials", () => {
  const user = userEvent.setup();
  const row = (provider: string, last4: string, displayValue?: string) => ({
    id: provider,
    provider,
    last4,
    ...(displayValue ? { displayValue } : {}),
    label: null,
    createdAt: new Date(),
    lastUsedAt: null,
  });

  beforeEach(() => {
    saveApiKey.mockReset();
    saveApiKey.mockResolvedValue({ success: true });
    deleteApiKey.mockReset();
    deleteApiKey.mockResolvedValue({ success: true });
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => fetchSpy.mockRestore());

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const openUsajobsForm = async () => {
    render(<ApiKeySettings />);
    await screen.findByText("USAJOBS");
    await user.click(
      screen.getByRole("button", { name: /add credentials/i }),
    );
  };

  it("shows a USAJOBS card with a link to the key request page", async () => {
    render(<ApiKeySettings />);

    expect(await screen.findByText("USAJOBS")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /request a key/i });
    expect(link).toHaveAttribute(
      "href",
      "https://developer.usajobs.gov/apirequest/",
    );
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
  });

  it("saves the key encrypted and the email as a plain value, without verifying", async () => {
    await openUsajobsForm();

    await user.type(screen.getByLabelText("API Key", { selector: "#key-usajobs" }), "sekrit-key-1234");
    await user.type(screen.getByLabelText("Registration email"), "me@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveApiKey).toHaveBeenCalledTimes(2));
    expect(saveApiKey).toHaveBeenCalledWith({
      provider: "usajobs",
      key: "sekrit-key-1234",
    });
    expect(saveApiKey).toHaveBeenCalledWith({
      provider: "usajobs_email",
      key: "me@example.com",
      sensitive: false,
    });
    // There is no verifier for these providers: the verify route is never hit.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets either half be updated on its own", async () => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [
        row("usajobs", "1234"),
        row("usajobs_email", "me@example.com", "me@example.com"),
      ],
    });
    render(<ApiKeySettings />);
    await screen.findByText("USAJOBS");
    await user.click(
      await screen.findByRole("button", { name: /update credentials/i }),
    );

    await user.type(screen.getByLabelText("Registration email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveApiKey).toHaveBeenCalledTimes(1));
    expect(saveApiKey).toHaveBeenCalledWith({
      provider: "usajobs_email",
      key: "new@example.com",
      sensitive: false,
    });
  });

  it("disables Save until a value is entered", async () => {
    await openUsajobsForm();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("never renders a saved key back, only its last four characters", async () => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [
        row("usajobs", "wxyz"),
        row("usajobs_email", "me@example.com", "me@example.com"),
      ],
    });
    const { container } = render(<ApiKeySettings />);

    expect(await screen.findByText("····wxyz")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/sekrit/);

    await user.click(screen.getByRole("button", { name: /update credentials/i }));
    expect(
      screen.getByLabelText("API Key", { selector: "#key-usajobs" }),
    ).toHaveValue("");
  });

  it("removes both stored values", async () => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [
        row("usajobs", "wxyz"),
        row("usajobs_email", "me@example.com", "me@example.com"),
      ],
    });
    render(<ApiKeySettings />);
    await user.click(
      await screen.findByRole("button", { name: /delete usajobs credentials/i }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteApiKey).toHaveBeenCalledTimes(2));
    expect(deleteApiKey).toHaveBeenCalledWith("usajobs");
    expect(deleteApiKey).toHaveBeenCalledWith("usajobs_email");
  });

  it("keeps the AI provider cards unchanged", async () => {
    render(<ApiKeySettings />);

    await screen.findByText("USAJOBS");
    expect(screen.getAllByRole("button", { name: /add key/i }).length).toBeGreaterThan(0);
  });
});
