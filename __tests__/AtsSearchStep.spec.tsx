import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AtsSearchStep } from "@/components/automations/AtsSearchStep";
import { UsajobsSearchStep } from "@/components/automations/UsajobsSearchStep";
import type { UsajobsSourceConfig } from "@/models/automation.model";
import { toastInfo } from "@/lib/toast";

const getUserApiKeys = vi.fn();
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
  getWatchedBoards: vi.fn().mockResolvedValue([
    { id: "1", name: "Acme", token: "acme", provider: "greenhouse" },
    { id: "2", name: "Beta", token: "beta", provider: "greenhouse" },
    { id: "3", name: "Gamma", token: "gamma", provider: "greenhouse" },
  ]),
}));

// TargetingFields pulls four entity actions for its chip inputs; all four must
// be mocked or the module throws at import.
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

vi.mock("@/actions/job.actions", () => ({
  createLocation: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

// Required by Radix UI Popover / Command components
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

document.createRange = () => {
  const range = new Range();
  range.getBoundingClientRect = vi.fn().mockReturnValue({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
  });
  range.getClientRects = () => ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: vi.fn(),
  });
  return range;
};

describe("AtsSearchStep batch add", () => {
  const user = userEvent.setup();

  const openPicker = async (companies: any[] = []) => {
    const onChange = vi.fn();
    render(
      <AtsSearchStep
        provider="greenhouse"
        value={{ companies } as any}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /search companies/i }));
    return onChange;
  };

  const clickAddAll = async () => {
    await user.click(
      await screen.findByRole("button", { name: /add all watched/i }),
    );
  };

  it("adds every watched board in exactly one onChange", async () => {
    const onChange = await openPicker();

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies).toHaveLength(3);
    expect(onChange.mock.calls[0][0].companies.map((c: any) => c.token)).toEqual(
      ["acme", "beta", "gamma"],
    );
  });

  it("dedupes against the current selection by token", async () => {
    const onChange = await openPicker([{ name: "Acme", token: "acme" }]);

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies.map((c: any) => c.token)).toEqual(
      ["acme", "beta", "gamma"],
    );
  });

  it("slices to the remaining slots at the 25 cap", async () => {
    const existing = Array.from({ length: 24 }, (_, i) => ({
      name: `C${i}`,
      token: `c${i}`,
    }));
    const onChange = await openPicker(existing);

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies).toHaveLength(25);
  });

  it("reports how many were skipped at the cap", async () => {
    const existing = Array.from({ length: 24 }, (_, i) => ({
      name: `C${i}`,
      token: `c${i}`,
    }));
    await openPicker(existing);

    await clickAddAll();

    expect(toastInfo).toHaveBeenCalledWith(expect.stringMatching(/2 skipped/i));
  });
});

describe("AtsSearchStep - watchlist boards unchanged", () => {
  it.each(["greenhouse", "lever", "ashby"] as const)(
    "%s still shows the company picker and no USAJOBS search form",
    (provider) => {
      render(
        <AtsSearchStep
          provider={provider}
          value={{ companies: [] } as any}
          onChange={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: /search companies/i }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Keyword")).toBeNull();
      expect(screen.queryByText(/USAJOBS/i)).toBeNull();
    },
  );
});

describe("UsajobsSearchStep", () => {
  const user = userEvent.setup();

  const base: UsajobsSourceConfig = {
    targetTitles: [],
    keywords: [],
    locations: [],
    strictLocation: false,
    topK: 10,
    saveUnanalyzed: true,
  };

  // Controlled harness so typing round-trips through onChange like the wizard.
  function Harness({
    initial = base,
    spy,
  }: {
    initial?: UsajobsSourceConfig;
    spy: (next: UsajobsSourceConfig) => void;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <UsajobsSearchStep
        value={value}
        onChange={(next) => {
          spy(next);
          setValue(next);
        }}
      />
    );
  }

  const last = (spy: ReturnType<typeof vi.fn>): UsajobsSourceConfig =>
    spy.mock.calls[spy.mock.calls.length - 1][0];

  beforeEach(() => {
    getUserApiKeys.mockReset();
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
  });

  it("renders the search form instead of the company picker", () => {
    render(<Harness spy={vi.fn()} />);

    expect(screen.getByLabelText("Keyword")).toBeInTheDocument();
    expect(screen.getByLabelText("Position title")).toBeInTheDocument();
    expect(screen.getByLabelText("Search locations")).toBeInTheDocument();
    expect(screen.getByLabelText("Agency codes")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Occupational series codes"),
    ).toBeInTheDocument();
    // Shared ranking fields are still present.
    expect(screen.getByText("Target job titles")).toBeInTheDocument();
    expect(screen.getByText(/Jobs analyzed per run/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /search companies/i }),
    ).toBeNull();
  });

  it("warns that a criterion is required until one is entered", { timeout: 20000 }, async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /at least one search criterion/i,
    );

    await user.type(screen.getByLabelText("Keyword"), "nurse");

    expect(last(spy).keyword).toBe("nurse");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops a cleared filter instead of saving an empty string", { timeout: 20000 }, async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...base, keyword: "a" }} spy={spy} />);

    await user.clear(screen.getByLabelText("Keyword"));

    expect(last(spy)).not.toHaveProperty("keyword");
  });

  it("adds search locations as chips and enables the radius", { timeout: 20000 }, async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    expect(screen.getByLabelText("Radius")).toBeDisabled();

    await user.type(screen.getByLabelText("Search locations"), "Denver{Enter}");
    expect(last(spy).locationName).toEqual(["Denver"]);
    expect(screen.getByLabelText("Radius")).toBeEnabled();

    await user.type(screen.getByLabelText("Radius"), "25");
    expect(last(spy).radius).toBe(25);
  });

  it("rejects malformed agency and series codes where they are typed", { timeout: 20000 }, async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);

    await user.type(screen.getByLabelText("Agency codes"), "af, nn{Enter}");
    expect(last(spy).organization).toEqual(["AF", "NN"]);

    await user.type(
      screen.getByLabelText("Occupational series codes"),
      "22{Enter}",
    );
    expect(screen.getByText(/exactly four digits/i)).toBeInTheDocument();
    expect(last(spy).jobCategoryCode).toBeUndefined();

    await user.clear(screen.getByLabelText("Occupational series codes"));
    await user.type(
      screen.getByLabelText("Occupational series codes"),
      "2210{Enter}",
    );
    expect(last(spy).jobCategoryCode).toEqual(["2210"]);
  });

  it("keeps secondary filters behind More filters and edits them", { timeout: 20000 }, async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...base, keyword: "it" }} spy={spy} />);

    expect(screen.queryByLabelText("Minimum salary")).toBeNull();
    await user.click(screen.getByRole("button", { name: /more filters/i }));

    fireEvent.change(screen.getByLabelText("Minimum salary"), {
      target: { value: "90000" },
    });
    expect(last(spy).remunerationMinimumAmount).toBe(90000);

    await user.click(screen.getByRole("button", { name: "Veterans" }));
    expect(last(spy).hiringPath).toEqual(["vet"]);
    await user.click(screen.getByRole("button", { name: "Full-time" }));
    expect(last(spy).positionScheduleTypeCode).toEqual([1]);
    await user.click(screen.getByRole("button", { name: "Veterans" }));
    expect(last(spy)).not.toHaveProperty("hiringPath");
  });

  it("opens More filters on edit when a secondary filter is already set", () => {
    render(
      <Harness
        initial={{ ...base, keyword: "it", remunerationMinimumAmount: 50000 }}
        spy={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Minimum salary")).toHaveValue(50000);
  });

  it("surfaces schema errors such as min above max", () => {
    render(
      <Harness
        initial={{
          ...base,
          keyword: "it",
          remunerationMinimumAmount: 200000,
          remunerationMaximumAmount: 100000,
        }}
        spy={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /minimum pay exceeds maximum pay/i,
    );
  });

  describe("credentials hint", () => {
    it("links to Settings -> API Keys when nothing is saved", async () => {
      render(<Harness spy={vi.fn()} />);

      const link = await screen.findByRole("link", {
        name: /settings.*api keys/i,
      });
      expect(link).toHaveAttribute("href", "/dashboard/settings#api-keys");
    });

    it("shows the hint when only half of the credentials are saved", async () => {
      getUserApiKeys.mockResolvedValue({
        success: true,
        data: [{ provider: "usajobs", last4: "abcd" }],
      });
      render(<Harness spy={vi.fn()} />);

      expect(
        await screen.findByRole("link", { name: /settings.*api keys/i }),
      ).toBeInTheDocument();
    });

    it("hides the hint once both are saved", async () => {
      getUserApiKeys.mockResolvedValue({
        success: true,
        data: [
          { provider: "usajobs", last4: "abcd" },
          { provider: "usajobs_email", last4: "me@example.com" },
        ],
      });
      render(<Harness spy={vi.fn()} />);

      await waitFor(() => expect(getUserApiKeys).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole("link", { name: /settings.*api keys/i })).toBeNull();
    });

    it("stays quiet if the lookup fails", async () => {
      getUserApiKeys.mockResolvedValue({ success: false });
      render(<Harness spy={vi.fn()} />);

      await waitFor(() => expect(getUserApiKeys).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole("link", { name: /settings.*api keys/i })).toBeNull();
    });
  });
});
