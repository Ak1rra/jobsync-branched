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

// Saved by the previous version: the server-side keyword/title/locations lived
// in keyword/positionTitle/locationName beside the ranking keywords/
// targetTitles/locations.
const legacyUsajobsAutomation = {
  id: "auto-1",
  userId: "u1",
  name: "Federal data jobs",
  jobBoard: "usajobs",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    usajobs: {
      keyword: "data scientist",
      positionTitle: "Statistician",
      locationName: ["Denver"],
      radius: 25,
      hiringPath: ["vet"],
      targetTitles: ["Data Scientist"],
      keywords: ["Python"],
      locations: ["Reno"],
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

// The same automation as saved now: one keywords, one titles and one
// locations list.
const usajobsAutomation = {
  ...legacyUsajobsAutomation,
  sourceConfig: JSON.stringify({
    usajobs: {
      radius: 25,
      hiringPath: ["vet"],
      targetTitles: ["Data Scientist", "Statistician"],
      keywords: ["Python", "data scientist"],
      locations: ["Reno", "Denver"],
      strictLocation: false,
      topK: 7,
      saveUnanalyzed: true,
    },
  }),
};

const user = userEvent.setup();

// Whole-value entry: user.type re-renders the entire wizard once per
// keystroke, which makes these tests slow under a loaded full-suite run.
const enter = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

// A chip field adds its entry on Enter.
const addChip = (el: HTMLElement, value: string) => {
  enter(el, value);
  fireEvent.keyDown(el, { key: "Enter" });
};

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
    expect(await screen.findByLabelText("Keywords / skills")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /search companies/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    addChip(screen.getByLabelText("Keywords / skills"), "nurse");
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

    await screen.findByLabelText("Keywords / skills");
    // Keywords, titles and locations are one field (one set of chips) each.
    expect(screen.getAllByText("Python")).toHaveLength(1);
    expect(screen.getAllByText("data scientist")).toHaveLength(1);
    expect(screen.getAllByText("Keywords / skills")).toHaveLength(1);
    expect(screen.getByLabelText("Radius")).toHaveValue(25);
    expect(screen.getByText("Denver")).toBeInTheDocument();
    expect(screen.getByText("Reno")).toBeInTheDocument();
    expect(screen.getByText("Data Scientist")).toBeInTheDocument();
    // No second title/location field.
    expect(screen.queryByText("Target job titles")).toBeNull();
    expect(screen.queryByLabelText("Search locations")).toBeNull();
    // A secondary filter is set, so the group starts open.
    expect(screen.getByRole("button", { name: "Veterans" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("opens a legacy config with its position title and locations in the one field each", { timeout: 30000 }, async () => {
    renderWizard(legacyUsajobsAutomation);
    await next();

    await screen.findByLabelText("Keywords / skills");
    // Folded: keyword joins keywords, positionTitle joins targetTitles,
    // locationName joins locations.
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("data scientist")).toBeInTheDocument();
    expect(screen.getByText("Data Scientist")).toBeInTheDocument();
    expect(screen.getByText("Statistician")).toBeInTheDocument();
    expect(screen.getByText("Reno")).toBeInTheDocument();
    expect(screen.getByText("Denver")).toBeInTheDocument();
    expect(screen.getByLabelText("Radius")).toHaveValue(25);
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("re-saves a legacy config in the unified shape", { timeout: 30000 }, async () => {
    renderWizard(legacyUsajobsAutomation);
    await next();
    await screen.findByLabelText("Keywords / skills");
    for (let i = 0; i < 4; i++) await next();
    await user.click(screen.getByRole("button", { name: /update automation/i }));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const saved = updateAutomation.mock.calls[0][1].sourceConfig.usajobs;
    expect(saved.keywords).toEqual(["data scientist", "Python"]);
    expect(saved.targetTitles).toEqual(["Statistician", "Data Scientist"]);
    expect(saved.locations).toEqual(["Denver", "Reno"]);
    expect(saved.radius).toBe(25);
    expect(saved).not.toHaveProperty("keyword");
    expect(saved).not.toHaveProperty("positionTitle");
    expect(saved).not.toHaveProperty("locationName");
  });

  it("saves an edited USAJOBS config under sourceConfig.usajobs", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await next();
    const keywords = await screen.findByLabelText("Keywords / skills");
    addChip(keywords, "statistician");
    for (let i = 0; i < 4; i++) await next(); // search -> resume -> match -> schedule -> review

    // The review step lists the USAJOBS filters instead of Companies.
    expect(
      screen.getByText("Python, data scientist, statistician"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Companies")).toBeNull();

    await user.click(screen.getByRole("button", { name: /update automation/i }));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const [id, input] = updateAutomation.mock.calls[0];
    expect(id).toBe("auto-1");
    expect(input.jobBoard).toBe("usajobs");
    expect(input.sourceConfig).toEqual({
      usajobs: expect.objectContaining({
        keywords: ["Python", "data scientist", "statistician"],
        targetTitles: ["Data Scientist", "Statistician"],
        locations: ["Reno", "Denver"],
        radius: 25,
        hiringPath: ["vet"],
        topK: 7,
      }),
    });
    expect(input.sourceConfig.usajobs).not.toHaveProperty("companies");
    expect(input.sourceConfig.usajobs).not.toHaveProperty("keyword");
    expect(input.sourceConfig.usajobs).not.toHaveProperty("positionTitle");
    expect(input.sourceConfig.usajobs).not.toHaveProperty("locationName");
  });

  it("still gates a Greenhouse automation on picking a company", { timeout: 30000 }, async () => {
    renderWizard();
    enter(screen.getByPlaceholderText(/full stack jobs/i), "GH");
    await next();

    expect(
      await screen.findByRole("button", { name: /search companies/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Keywords / skills")).toBeNull();
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
    expect(screen.getByText("Keywords")).toBeInTheDocument();
    expect(screen.getByText("Python, data scientist")).toBeInTheDocument();
    expect(screen.getByText("Radius")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("Veterans")).toBeInTheDocument();
    // Titles and locations are listed once, from the shared fields.
    expect(screen.getByText("Position titles")).toBeInTheDocument();
    expect(screen.getByText("Data Scientist, Statistician")).toBeInTheDocument();
    expect(screen.getByText("Reno, Denver")).toBeInTheDocument();
    expect(screen.queryByText("Search locations")).toBeNull();
    expect(screen.queryByText("Target titles")).toBeNull();
  });

  it("folds a legacy config's keyword, position title and locations into the same rows", async () => {
    render(
      <AutomationSearchConfig
        sourceConfig={legacyUsajobsAutomation.sourceConfig}
        jobBoard="usajobs"
        retired={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /show more/i }));

    expect(screen.getByText("Statistician, Data Scientist")).toBeInTheDocument();
    expect(screen.getByText("Denver, Reno")).toBeInTheDocument();
    expect(screen.getByText("data scientist, Python")).toBeInTheDocument();
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
    expect(screen.getByText("Python, data scientist")).toBeInTheDocument();
    expect(screen.getByText("Data Scientist, Statistician")).toBeInTheDocument();
    expect(screen.getByText("Reno, Denver")).toBeInTheDocument();
  });

  it("shows a legacy USAJOBS card's position title and locations", () => {
    renderList([legacyUsajobsAutomation]);

    expect(screen.getByText("data scientist, Python")).toBeInTheDocument();
    expect(screen.getByText("Statistician, Data Scientist")).toBeInTheDocument();
    expect(screen.getByText("Denver, Reno")).toBeInTheDocument();
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

describe("AutomationWizard - schedule step", () => {
  const weeklyAutomation = {
    ...usajobsAutomation,
    scheduleFrequency: "weekly",
    scheduleDayOfWeek: 3,
  };

  // basics -> search -> resume -> matching -> schedule
  const toSchedule = async () => {
    for (let i = 0; i < 4; i++) await next();
  };
  const daySelect = () =>
    screen.queryByRole("combobox", { name: /day of the week/i });

  it("defaults a new schedule to daily with no weekday picker", { timeout: 30000 }, async () => {
    renderWizard();

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Weekly" })).not.toBeChecked();
    expect(daySelect()).toBeNull();
  });

  it("shows a weekday picker defaulting to Monday when Weekly is chosen", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await toSchedule();

    await user.click(screen.getByRole("radio", { name: "Weekly" }));

    expect(daySelect()).toHaveTextContent("Monday");
    // The hour picker stays.
    expect(screen.getByText("Weekly Run Time")).toBeInTheDocument();
  });

  it("saves a weekly schedule and shows it on the review step", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await toSchedule();

    await user.click(screen.getByRole("radio", { name: "Weekly" }));
    await user.click(daySelect()!);
    await user.click(await screen.findByRole("option", { name: "Friday" }));
    await next();

    expect(screen.getByText("Weekly on Friday at 09:00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /update automation/i }));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const [, input] = updateAutomation.mock.calls[0];
    expect(input).toMatchObject({
      scheduleHour: 9,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 5,
    });
  });

  it("loads a weekly automation's frequency and weekday into the edit form", { timeout: 30000 }, async () => {
    renderWizard(weeklyAutomation);
    await toSchedule();

    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    expect(daySelect()).toHaveTextContent("Wednesday");
  });

  it("switches a weekly automation back to daily and drops the weekday", { timeout: 30000 }, async () => {
    renderWizard(weeklyAutomation);
    await toSchedule();

    await user.click(screen.getByRole("radio", { name: "Daily" }));
    expect(daySelect()).toBeNull();
    await next();
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /update automation/i }));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const [, input] = updateAutomation.mock.calls[0];
    expect(input.scheduleFrequency).toBe("daily");
    expect(input.scheduleDayOfWeek).toBeNull();
  });

  it("re-saves an existing daily automation unchanged", { timeout: 30000 }, async () => {
    renderWizard(usajobsAutomation);
    await toSchedule();
    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
    await next();
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /update automation/i }));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const [, input] = updateAutomation.mock.calls[0];
    expect(input).toMatchObject({
      scheduleHour: 9,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });
  });
});

describe("AutomationList - schedule", () => {
  const renderList = (automations: any[]) =>
    render(
      <AutomationList
        automations={automations}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

  it("labels a daily automation", () => {
    renderList([{ ...usajobsAutomation, scheduleFrequency: "daily" }]);
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();
  });

  it("labels an automation saved before frequencies existed as daily", () => {
    renderList([usajobsAutomation]);
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();
  });

  it("labels a weekly automation with its weekday", () => {
    renderList([
      { ...usajobsAutomation, scheduleFrequency: "weekly", scheduleDayOfWeek: 1 },
    ]);
    expect(screen.getByText("Weekly on Monday at 09:00")).toBeInTheDocument();
  });
});
