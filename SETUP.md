# Setting up Assignment Smasher on Cloudflare

This is a Cloudflare Pages site with two Pages Functions behind `/api/`, a D1 database for project
records, an R2 bucket for uploaded briefs and rubrics, and a Claude API key for the analysis itself.
Nothing here runs anywhere else — no separate server to manage.

## 1. Push the code

If this hasn't been pushed yet: create an empty GitHub repository (no README, no `.gitignore` — this
folder already has one), then tell Claude the repository's URL so it can push what's already built here.

## 2. Create the D1 database

Storage & Databases → D1 SQL database → Create. Name it `assignment-smasher`. Open its **Console**
tab, paste in the contents of `db/schema.sql`, and run it.

If the database already existed before 2026-10-09 (the "check your draft" feature), it won't have
the columns that feature needs yet — paste the contents of `db/migrations/001_feedback.sql` into the
same Console and run it once. Likewise if it existed before the admin usage summary, run
`db/migrations/002_usage.sql` too, and if it existed before the project settings page's "Additional
context" box, run `db/migrations/003_additional_context.sql` too. A brand new database from
`db/schema.sql` already has every column each migration adds; skip any that don't apply.

## 3. Create the R2 bucket

R2 → Create bucket. Name it `assignment-smasher-files`. Nothing else to configure — the app only
needs to put and get objects by key, no public access.

## 4. Create the Pages project

Workers & Pages → **Create** → **Pages** → **Connect to Git** (use the legacy Pages import — this is
the same route the HubSpot tracker used, not the newer unified Workers creation flow, because that one
doesn't wire up Pages Functions the way this app expects). Pick this repository and the `main` branch.

**Set the build command to `npm ci`.** Unlike the HubSpot tracker, this site has real npm
dependencies (`@anthropic-ai/sdk`, `zod`) that the Functions need at build time. With no build
command, Cloudflare skips straight to bundling the Functions without ever installing them, and the
build fails with `Could not resolve "@anthropic-ai/sdk"` (and the same for every other import) because
`node_modules` never existed. `npm ci` installs exactly what `package-lock.json` pins, which is what a
build step should do. Leave the build output directory as `/` (or blank) — this setting is unrelated to
the Functions bundling step; it's just where the static `index.html` is served from. Deploy.

If the build command needs changing after the project already exists: Settings → Builds & deployments →
Build configuration → Build command.

## 5. Bind the database, the bucket and the API key

Open the Pages project → Settings → Bindings (or Functions, depending on the dashboard version) → Add,
for **both** Production and Preview:

- **D1 database** — variable name exactly `DB`, database `assignment-smasher`.
- **R2 bucket** — variable name exactly `FILES`, bucket `assignment-smasher-files`.
- **Environment variable (Encrypt it)** — variable name exactly `ANTHROPIC_API_KEY`, value the Claude
  API key. Create a key just for this app in the Anthropic console, and set a monthly spend limit
  there too (a few pounds is generous at a project or two a term).
- **Environment variable** — variable name exactly `ADMIN_EMAILS`, value a comma-separated list of
  the email addresses that should see the Admin screen (see all projects across everyone, delete
  any of them). Just your own email to start; add more the same way, comma-separated. Nobody is an
  admin if this is left unset.

Then go to Deployments, open the latest one and **Retry deployment** — bindings only take effect on a
deployment made after they're added.

## 6. Lock the site down with Cloudflare Access

This app has no login screen of its own — Cloudflare Access sits in front of the whole site instead,
and only lets an allow-listed email in.

Zero Trust → Access → Applications → **Add an application** → **Self-hosted**. Point it at this
project's `pages.dev` domain (or a custom domain, if one gets added later). Add a policy that allows
a short list of email addresses — Dan's to start, with anyone else (his sister Pippa, say) added the
same way later. Access handles sign-in with a one-time emailed code, nothing to install.

Once this is on, every request — including the ones the page itself makes to `/api/...` — carries a
verified identity that the Pages Functions read from the `Cf-Access-Authenticated-User-Email` header.
Each project belongs to whichever email created it, so Dan and Pippa would never see each other's work.

## Checking it's working

Open the site. Access should ask for a one-time code before showing anything. Once past that, create a
test project with a short PDF as the brief — the deliverables, criteria and a milestone plan should
come back within well under a minute. If it fails instead, the error message on screen says why (a
missing API key, a missing binding, or Claude declining the request) rather than a generic failure.

## What's built so far, and what isn't

Built: creating a project from an uploaded brief (and an optional rubric), Claude reading it into
deliverables, assessment criteria, things worth checking with a tutor, and a milestone plan with
realistic dates; editing that plan by hand; re-reading the brief if the first pass wasn't right;
expanding any one milestone, on request, into a short step-by-step checklist grounded in the actual
brief — generated once and stored, collapsed by default, with a Regenerate option; uploading a draft
or final document to get feedback against the brief, rubric and assessment criteria before
submitting it for real — requirement checks (word count, format, and so on), strengths and gaps per
criterion, and a rough indicative band, never a rewrite and never a precise grade. Re-uploading a
revised draft replaces the old one and clears the old feedback; ticking a milestone done (and, now,
each generated step within it individually — ticking every step offers a one-click way to mark the
whole milestone done too), and a progress widget at the top of the project page comparing expected
pace (how far through the milestone schedule today's date falls) against actual pace (days' worth of
ticked milestones), with a days-ahead/behind figure — a real day count, not a milestone count, so
milestones of different sizes don't distort it. The dashboard shows a compact version of the same
ahead/behind badge on each project row, without needing to open it. The admin screen shows how many
Claude calls each project (and the account as a whole) has made and a rough estimated cost — Opus 5
rates, no prompt-cache discount applied, so the real bill will usually run a little lower than this.

An "Easier reading mode" toggle, remembered per device, for dyslexic students — based on the British
Dyslexia Association guidance as described in
[Smashing Magazine's dyslexia-friendly mode article](https://www.smashingmagazine.com/2021/11/dyslexia-friendly-mode-website/):
wider letter- and word-spacing, double line-height, a heavier font weight, no ligatures, and more
space between paragraphs. It's a toggle rather than a forced site-wide change, since not everyone who
opens the site is dyslexic. The colour palette was reworked to a warmer, softer scheme — still
checked against WCAG AA contrast (4.5:1 for text, 3:1 for large text and UI components), but without
the very high-contrast extremes that can themselves cause glare for some dyslexic readers. All-caps
badges were switched to plain mixed case (capitals lose their word-shape, which slows reading), the
heading font changed from a condensed to a regular weight, and lists use alternating row shading so
it's easier to tell where one item ends and the next begins. Every piece of text the student sees —
both the fixed interface copy and everything Claude generates (the plan, the milestone steps, the
draft feedback) — was rewritten or prompted for a plainer reading level: short sentences, one idea
each, everyday words over formal ones. This hasn't been checked with an actual dyslexic reader yet —
the Smashing Magazine article itself stresses testing with real users, so it's worth getting Dan's
feedback on whether the toggle's intensity feels right before treating this as finished.

A project settings page, reachable from "Project settings" on the project page itself (available in
every project status, not just once the plan is ready). It shows the project's details — title,
subject, dates, status and the uploaded files — and an "Additional context" box: free text the student
can add at any point, for things that come up after the brief was first read — an answer to a question
the brief left open, a note from a tutor, something to focus on. It's saved onto the project and passed
to Claude alongside the brief on every later call (building the plan, generating a milestone's steps,
checking a draft), framed as the student's own note rather than part of the brief itself, so the brief
and rubric still win if the two ever disagree.

Supporting documents: when creating a project, up to 5 extra files (PDFs or images — JPG, PNG, GIF or
WEBP, 8MB each) can be attached alongside the brief, for anything else that gives Claude more context —
lecture notes, a photo of a whiteboard or handwritten notes, earlier feedback. An image is sent to
Claude as an image, not squeezed through a PDF. Like the additional-context text box, these are passed
on every later call (building the plan, generating a milestone's steps, checking a draft), clearly
labelled as the student's own extra material rather than the brief or rubric. Shown on the project
settings page alongside the brief and rubric. Can only be added when the project is first created, not
afterwards — a deliberate scoping choice, not an oversight.

Not yet built: an "I'm stuck" helper for when a student is partway through a step and needs a nudge;
adding or removing supporting documents after a project has already been created.

## Local development

`wrangler pages dev .` with a local `wrangler.toml` binding `DB` (D1), `FILES` (R2) and
`ANTHROPIC_API_KEY`, plus a `DEV_MODE = "1"` variable so requests work without Cloudflare Access in
front of them. That `wrangler.toml` is deliberately not committed — Cloudflare Pages projects created
through the dashboard don't need one in the repo, and `DEV_MODE` must never be set on the real
project, or the Access lock stops meaning anything.
