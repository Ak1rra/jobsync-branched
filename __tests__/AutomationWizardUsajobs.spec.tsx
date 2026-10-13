import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationWizard } from "@/components/automations/AutomationWizard";
import { AutomationList } from "@/components/automations/AutomationList";
import { AutomationSearchConfig } from "@/components/automations/automation-detail-container/AutomationSearchConfig";

const createAutomation = vi.fn();
const updateAutomation = vi.fn();
const getUserApiKeys = vi.fn();

vi.mock("@/actions/automation.actions", () => ({
  createAutomation: (input: unknown) => createAutomation(input),
  updateAutomation: (id: string, input: unknown) => updateAutomation(id, input),
  pauseAutomation: vi.fn(),
  resumeAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}));
vi.mock("@/actions/apiKey.actions", () => ({
  getUserApiKeys: () => getUserApiKeys(),
}));
vi.mock("@/actions/atsCompany.actions", () => ({
  searchAtsCompanies: vi
    .fn()
    .mockResolvedValue({ companies: [], hasMore: false }),
  getAtsCompanyCount: vi.fn().mockResolvedValue(0),
  resolveAtsBoard: vi.fn(),
}));
vi.mock("@/actions/company.actions", () => ({
  getWatchedBoards: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/actions/jobtitle.actions", () => ({
  getAllJobTitles: vi.fn().mockResolvedValue([]),
  createJobTitle: vi.fn(),
}));
vi.mock("@/actions/tag.actions", () => ({
  getAllTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
}));
vi.mock("@/actions/jobLocation.actions", () => ({
  getAllJobLocations: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/actions/job.actions", () => ({ createLocation: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

// Required by Radix UI Select / Popover / Command components
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const RESUME_ID = "6f1f3c1e-2a0b-4a54-9b7f-0d3c5a8e9b11";
const resumes = [{ id: RESUME_ID, title: "My Resume", sectionCount: 6 }];

const usajobsAutomation = {
  id: "auto-1",
  userId: "u1",
  name: "Federal data jobs",
  jobBoard: "usajobs",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    usajobs: {
      keyword: "data scientist",
      locationName: ["Denver"],
      radius: 25,
      hiringPath: ["vet"],
      targetTitles: ["Data Scientist"],
      keywords: [],
      locations: [],
      strictLocation: false,
      topK: 7,
      saveUnanalyzed: true,
    },
  }),
  resumeId: RESUME_ID,
  matchThreshold: 70,
  scheduleHour: 9,
  status: "active",
  resume: { id: RESUME_ID, title: "My Resume" },
} as any;

const user = userEvent.setup();

// Whole-value entry: user.type re-renders the entire wizard once per
// keystroke, which makes these tests slow under a loaded full-suite run.
const enter = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

// The wizard mounts every step at once, so the wizard tests below are heavier
// than a single-component test and get a longer per-test timeout.

function renderWizard(editAutomation?: any) {
  const onSuccess = vi.fn();
  render(
    <AutomationWizard
      open
      onOpenChange={vi.fn()}
      resumes={resumes}
      automations={[]}
      onSuccess={onSuccess}
      editAutomation={editAutomation}
    />,
  );
  return { onSuccess };
}

const next = () => user.click(screen.getByRole("button", { name: /next/i }));

beforeEach(() => {
  createAutomation.mockReset().mockResolvedValue({ success: true });
  updateAutomation.mockReset().mockResolvedValue({ success: true });
  getUserApiKeys.mockReset().mockResolvedValue({ success: true, data: [] });
});

describe("AutomationWizard - USAJOBS", () => {
  it("offers USAJOBS as a job board and gates Next on a search criterion", { timeout: 30000 }, async () => {
    renderWizard();

    enter(screen.getByPlaceholderText(/full stack jobs/i), "Federal jobs");
    await user.click(screen.getByLabelText(/job board/i));
    await user.click(await screen.findByRole("option", { name: /usajobs/i }));
    await next();

    // Search step: a search form, not a company picker.
    expect(await screen.findByLabelText("Keyword")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /search companies/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    enter(screen.getByLabelText("Keyword"), "nurse");
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("keeps Next disabled for filters that are not a criterion", { timeout: 30000 }, async () => {
    renderWizard();
    enter(screen.getByPlaceholderText(/full stack jobs/i), "x");
    await user.click(screen.getByLabelText(/job board/i));
    await user.click(await screen.findByRole("option", { name: /usajobs/i }));
    await next();

    await user.click(await screen.findByRole("button", { name: /more filters/i }));
    await user.click(screen.getByRole("button", { name: "Veterans" }));

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("loads an existing USAJOBS automation into the edit form", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await next();

    expect(await screen.findByLabelText("Keyword")).toHaveValue(
      "data scientist",
    );
    expect(screen.getByLabelText("Radius")).toHaveValue(25);
    expect(screen.getByText("Denver")).toBeInTheDocument();
    // A secondary filter is set, so the group starts open.
    expect(screen.getByRole("button", { name: "Veterans" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("saves an edited USAJOBS config under sourceConfig.usajobs", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await next();
    const keyword = await screen.findByLabelText("Keyword");
    enter(keyword, "statistician");
    for (let i = 0; i < 4; i++) await next(); // search -> resume -> match -> schedule -> review

    // The review step lists the USAJOBS filters instead of Companies.
    expect(screen.getByText("statistician")).toBeInTheDocument();
    expect(screen.queryByText("Companies")).toBeNull();

    await user.click(screen.getByRole("button", { name: /update automation/i }));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const [id, input] = updateAutomation.mock.calls[0];
    expect(id).toBe("auto-1");
    expect(input.jobBoard).toBe("usajobs");
    expect(input.sourceConfig).toEqual({
      usajobs: expect.objectContaining({
        keyword: "statistician",
        locationName: ["Denver"],
        radius: 25,
        hiringPath: ["vet"],
        topK: 7,
      }),
    });
    expect(input.sourceConfig.usajobs).not.toHaveProperty("companies");
  });

  it("still gates a Greenhouse automation on picking a company", { timeout: 30000 }, async () => {
    renderWizard();
    enter(screen.getByPlaceholderText(/full stack jobs/i), "GH");
    await next();

    expect(
      await screen.findByRole("button", { name: /search companies/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Keyword")).toBeNull();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});

describe("AutomationSearchConfig - USAJOBS", () => {
  it("shows the saved search filters instead of a company list", async () => {
    render(
      <AutomationSearchConfig
        sourceConfig={usajobsAutomation.sourceConfig}
        jobBoard="usajobs"
        retired={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /show more/i }));

    expect(screen.queryByText("Companies")).toBeNull();
    expect(screen.getByText("Keyword")).toBeInTheDocument();
    expect(screen.getByText("data scientist")).toBeInTheDocument();
    expect(screen.getByText("Denver (within 25)")).toBeInTheDocument();
    expect(screen.getByText("Veterans")).toBeInTheDocument();
    expect(screen.getByText("Data Scientist")).toBeInTheDocument();
  });

  it("still lists companies with board links for Greenhouse", async () => {
    render(
      <AutomationSearchConfig
        sourceConfig={JSON.stringify({
          greenhouse: { companies: [{ name: "Acme", token: "acme" }] },
        })}
        jobBoard="greenhouse"
        retired={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /show more/i }));

    expect(screen.getByText("Companies")).toBeInTheDocument();
    expect(screen.getByLabelText("Open Acme job board")).toHaveAttribute(
      "href",
      expect.stringContaining("/acme"),
    );
  });
});

describe("AutomationList - USAJOBS", () => {
  const renderList = (automations: any[]) =>
    render(
      <AutomationList
        automations={automations}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

  it("labels the board USAJOBS and summarizes the filters", () => {
    renderList([usajobsAutomation]);

    expect(screen.getByText("USAJOBS")).toBeInTheDocument();
    expect(screen.getByText("data scientist")).toBeInTheDocument();
    expect(screen.getByText("Denver (within 25)")).toBeInTheDocument();
  });

  it("leaves a Greenhouse card as it was", () => {
    renderList([
      {
        ...usajobsAutomation,
        id: "gh",
        jobBoard: "greenhouse",
        sourceConfig: JSON.stringify({
          greenhouse: { companies: [{ name: "Acme", token: "acme" }] },
        }),
      },
    ]);

    expect(screen.getByText("greenhouse")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("USAJOBS")).toBeNull();
  });
});
