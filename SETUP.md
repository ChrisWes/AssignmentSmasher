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
realistic dates; editing that plan by hand; re-reading the brief if the first pass wasn't right.

Not yet built: turning each milestone into day-to-day tasks with how-to steps (the next piece, in the
same style as the HubSpot course tracker), ticking off progress, and an "I'm stuck" helper. The
`outline_json` this stores is already shaped to have `tasks` added to each milestone later without
needing to change what's already saved.

## Local development

`wrangler pages dev .` with a local `wrangler.toml` binding `DB` (D1), `FILES` (R2) and
`ANTHROPIC_API_KEY`, plus a `DEV_MODE = "1"` variable so requests work without Cloudflare Access in
front of them. That `wrangler.toml` is deliberately not committed — Cloudflare Pages projects created
through the dashboard don't need one in the repo, and `DEV_MODE` must never be set on the real
project, or the Access lock stops meaning anything.
