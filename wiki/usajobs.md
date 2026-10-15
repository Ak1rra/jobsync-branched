---
type: how-to
title: USAJOBS automations
description: Searching US federal job announcements from an automation — getting and saving a USAJOBS API key, the search filters, what runs at USAJOBS versus in JobSync, paging, rate limits, deduplication, known limitations and how to test it.
feature: automations
tags: [usajobs, federal jobs, government jobs, api key, registration email, automations, search filters, hiring path, pay grade, occupational series, rate limit, pagination, deduplication, due date]
aliases: [usajobs.gov, federal job search, government job search, usajobs api key]
status: stable
stale_after: 2027-09-30
---

# USAJOBS automations

## How does the USAJOBS board work?

**USAJOBS** is the one automation board that is not a list of companies. You describe a search, and each run asks the official USAJOBS Search API for matching federal announcements. The results then go through the same pipeline as [Greenhouse, Lever and Ashby](./automations.md): deduplicate, rank against your titles, keywords and resume skills, apply the relevance floor, AI-score the top candidates, and save the ones that reach your match threshold. *Position titles*, *Keywords / skills*, *Locations*, *Jobs analyzed per run* and the match threshold behave exactly as described on the Automations page.

Technically, USAJOBS is a *query provider*: instead of fetching a list of company boards it makes one search. For the run's bookkeeping that search counts as a single pseudo-board named *USAJOBS search*, so its failures reach **Run History** and the notification bell like any other board failure. The daily schedule and **Run Now** work as usual.

## How do I get and save a USAJOBS API key?

Request a free key at [developer.usajobs.gov/apirequest](https://developer.usajobs.gov/apirequest/). USAJOBS also requires the email address you registered with, which it reads from every request. Then use either route:

- **Settings → API Keys → USAJOBS.** Click **Add credentials** and enter the key and the registration email. The key is encrypted and only its last four characters are shown again; the email is shown in full. Leave one field blank to update only the other, but a run needs both saved (or neither, to use the server's). The bin button removes both.
- **Server environment.** The administrator sets `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT_EMAIL`.

The key and the email are used as a pair and are never mixed between sources. If you saved both in Settings, those are used. If you saved neither, the server's `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT_EMAIL` are used, and both must be set. If you saved only one of the two, the run fails with *USAJOBS is not configured* and the run log says which half is missing; save the other one, or delete the one you saved to use the server's credentials. A key with spaces or non-ASCII characters is rejected when you save it, and the same check at run time reports which value is invalid. Credentials are never written to run logs or error messages.

There is no **Verify** step for USAJOBS, unlike the AI providers: it has no way to check a key without running a search. A wrong value shows up as a failed run (*401* or *403*), and a run with nothing configured fails with *USAJOBS is not configured*. If you have not saved credentials, the wizard's Search step shows an amber hint linking to **Settings → API Keys**; it can only see what you saved in Settings, so ignore it if your server provides the environment variables.

## How do I create a USAJOBS automation?

In the wizard, choose **USAJOBS (US federal jobs)** as the job board. The **Search** step then shows a search form instead of the company picker:

- **Keywords / skills**, **Position titles** and **Locations** with an optional **Radius** (a radius needs a location) and the **Only show jobs in these locations** switch, **Agency codes**, and **Occupational series codes** (four digits, such as `2210`). Type an entry and press Enter to add it as a chip (keywords also accept a comma). Add as many as you like; all rank results, but only the first few are sent to USAJOBS (see below).
- Under **More filters**: minimum and maximum annual salary, pay grade low and high, hiring path, who may apply, remote only or exclude remote, schedule, appointment type codes, security clearance, posted within a number of days, and sort field and direction.
- The shared *Jobs analyzed per run* and *Save additional relevant listings*.

Keywords, position titles and locations appear **once** each: the same list is both what USAJOBS is asked to search for and what the ranking step scores against, so there is no separate field to keep in sync. At least one of keyword, position title, location, agency code or series code is required, because a search with none would pull an arbitrary slice of every open federal job. **Next** stays disabled until you add one, and the wizard lists anything else that cannot be saved, such as a minimum salary above the maximum. Because the locations also drive the strict-location switch, turning it on together with a radius drops nearby jobs whose location text matches none of your locations; leave it off if you rely on the radius.

**Edit** reopens the wizard with the saved search filled in, and the automation's page shows the saved filters under **Show more**.

## Which filters run at USAJOBS and which run in JobSync?

**Sent to USAJOBS (server-side):** keywords (see below), position titles, locations and radius, agency codes, series codes, minimum and maximum salary, pay grade low and high, hiring path, who may apply, remote, schedule, appointment type, security clearance, date posted, and sort field and direction. Multi-value filters travel semicolon-separated, so a location (or other multi-value entry) containing `;` is rejected when you save. The first 10 locations are sent together as one `LocationName` value (USAJOBS documents no limit; 10 keeps the address short). USAJOBS documents `PositionTitle` as a single value with no multi-value separator, so each of your first 5 position titles is its own search: JobSync runs them one after another within the same time limit, page and job ceilings and retry rules, and merges the results, counting an announcement that several titles return once.

Keywords are searched one by one only when you have **no position title**. USAJOBS documents `Keyword` as matching "all of the words specified (or synonyms of the word)" and no way to pass several values, so joining keywords into one value would require all of them to match. With no title, JobSync searches each of your first 5 keywords separately and merges the results. With a title, the titles drive the searches and the keywords only rank results, because combining them would multiply the requests.

Entries beyond the limits (5 titles, 5 keywords when there is no title, 10 locations) are kept, still rank results and still feed the strict-location switch, but are not sent to USAJOBS. The run log then shows a note such as *Searched USAJOBS for the first 5 of 7 titles; all 7 still rank results*; the run still finishes as **completed**. Put the entries you most want searched first.

**Applied by JobSync after the fetch (client-side):**

- An announcement whose closing date has already passed is dropped.
- The salary filter is re-checked against the announcement's actual annual range, because USAJOBS matches salary by coarse bucket. Announcements with no annual figure, such as hourly pay, are kept rather than dropped.
- Keywords, position titles, locations and the strict-location switch also run in the shared ranking step.

*Who may apply* set to *Status* or *All* additionally requires specific authorization from OPM.

## How many jobs does a run fetch, and what happens when USAJOBS fails?

Results are fetched **50 per page**, one page at a time with a short pause between pages, up to **10 pages or 500 jobs** per run. The whole search, including retries, must finish within 60 seconds. Reaching the page or job ceiling is not an error: the run still finishes as **completed** with what it fetched, and the run log shows a warning such as *Result ceiling reached: fetched 500 of 1,234 matching announcements - narrow your filters to see the rest*. Narrow the search if you see it regularly.

The ceilings and the 60-second limit cover all of a run's searches together (one per title, or per keyword when there are no titles), so with several titles a broad first title can use them up before the later ones run (the warning above appears then). If the search, or any one of the title searches, fails, the jobs already fetched are kept and the run finishes as **completed with errors**, with a note saying how many jobs and pages were kept; the remaining titles are still searched unless the failure was a rejected key, a timeout or a rate limit. With no jobs at all it is **failed**.

**Rate limits and retries:**

- A `429` with a `Retry-After` of 5 seconds or less is waited out and retried. A longer `Retry-After` is not waited for: the search ends with a *rate limited* reason and the next scheduled run tries again.
- A `429` without `Retry-After`, any `5xx`, and network errors are retried with exponential backoff plus jitter, for up to 3 attempts per page.
- `401` and `403` (key or email rejected) and `400` (search rejected as invalid) are never retried.

## How are USAJOBS jobs deduplicated and dated?

A job is identified by its announcement URL, compared in the same normalized form as every other board. Announcements you already have, whether saved by any automation or added by hand, are skipped, so a repeated run only adds announcements it has not saved before.

**Existing records are not updated.** If USAJOBS later changes an announcement, such as a new closing date or a revised description, the saved job keeps what it had when it was found. An announcement scored below your match threshold is not saved, so it is evaluated again on later runs while it stays open.

A discovered USAJOBS job gets the announcement's closing date (`ApplicationCloseDate`) as its due date, instead of the usual three days from discovery. If USAJOBS gives no parseable closing date, the three-day default applies.

## What happened to automations saved before keywords, titles and locations were merged?

Earlier versions had a separate server-side *Keyword*, *Position title* and *Search locations*, next to the ranking *Keywords / skills*, *Target job titles* and *Locations*. Saved automations from then keep working: when one is run or opened, its old keyword, position title and search locations are added, **first**, to the keywords, titles and locations lists (duplicates ignored, ignoring case), and **Edit** shows them in the single field. They go first because only the first few entries are sent to USAJOBS. Every one of your first 5 titles is now also a search, so an automation that had several ranking-only target titles makes one request per title. An automation that had both a keyword and a position title used to send both; it now searches by title only and uses the keyword for ranking, so it may fetch a broader set. Nothing is dropped from a saved list, and nothing is rewritten until you save the automation.

## What are the known limitations of the USAJOBS board?

- JobSync sends the `Host: data.usajobs.gov` header the API documents, but Node's `fetch` ignores a caller-supplied `Host` header. The request goes to `data.usajobs.gov` because the URL's host is that name.
- The USAJOBS documentation is inconsistent about the schedule filter: `PositionScheduleTypeCode` as a request parameter, `PositionSchedule` elsewhere. JobSync sends `PositionScheduleTypeCode`, which has not been confirmed against the live API.
- The integration has been tested against recorded responses only. It has not been verified against the live API, because that needs a key.
- There is no key verifier, so saving credentials proves nothing.
- The documentation is inconsistent about the casing of *Who may apply*: its acceptable-values text lists `"All"`, `"Public"`, `"Status"` while its example URL uses `WhoMayApply=public`. JobSync sends the capitalized form from the acceptable-values text; this has not been confirmed against the live API.
- The documentation does not state the unit of `Radius`, so the wizard does not label one. Its upper bound of 500 is a conservative choice.

## How do I run the USAJOBS tests?

The fetch, mapper, runner and config-validation tests run with:

```bash
npx vitest run __tests__/usajobs-*.spec.ts __tests__/usajobsSourceConfig.schema.spec.ts
```

The wizard, settings and review screens are covered by `__tests__/AtsSearchStep.spec.tsx`, `__tests__/AutomationWizardUsajobs.spec.tsx`, `__tests__/ApiKeySettings.spec.tsx`, `__tests__/usajobsConfig.spec.ts` and `__tests__/wizardConfig.spec.ts`.
