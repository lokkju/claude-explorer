# Security

## Reporting a vulnerability

This is a solo-maintained project. Two disclosure channels, in order of preference:

1. **GitHub Security Advisories (preferred)**: open a private report at <https://github.com/rpeck/claude-explorer/security/advisories/new>. This is discoverable from the repo "Security" tab and routes directly to the maintainer without exposing the report publicly. Use this whenever possible — it threads cleanly into a private fix draft and a published GHSA on disclosure.
2. **Email (fallback)**: for reporters without a GitHub account, email `raymondpeckiii@gmail.com` with the subject prefix `[claude-explorer security]`.

For non-sensitive issues (no vulnerability content), open a regular GitHub issue at <https://github.com/rpeck/claude-explorer/issues>.

There is no formal SLA; I aim to acknowledge within a few days and ship a fix as soon as practical.

## Code-checking tooling

Beyond the one-time audits below, several tools run continuously to keep security and code-quality regressions out of the tree. They cover different failure modes (real-time pattern interception, diff-level LLM review, AST static analysis, secret/credential greps, and deep maintainability review), and none replaces the others.

### Real-time edit interception — `security-guidance` plugin (Anthropic)

A user-scope Claude Code plugin (`security-guidance@claude-plugins-official`) that runs as a `PreToolUse` hook. It intercepts every `Write` / `Edit` / `MultiEdit` and warns, before the change is even written, about a curated list of known-bad patterns: `eval`, `pickle` of untrusted data, `dangerouslySetInnerHTML`, `child_process.exec`, GitHub Actions injection, and command-injection shapes. It runs at the harness level at effectively zero token cost. Policy: if it fires during normal editing, read the warning and fix the pattern rather than overriding it. (This very file tripped that hook while being written, since it names the patterns the plugin blocks.)

### Diff-level security review — `/security-review`

The built-in Claude Code `/security-review` slash command runs an LLM security review of the pending diff on the current branch, using the same engine as the [`anthropics/claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) GitHub Action. It covers SQL injection, XSS, authn/authz, IDOR, SSRF, weak crypto, RCE and unsafe deserialization, hardcoded secrets, and supply-chain risks. It runs manually as part of the pre-push checklist. On the 2026-05-27 pre-publish sweep it caught a stored-HTML-injection path in the PDF exporter (a maliciously titled conversation could have exfiltrated through WeasyPrint's URL fetcher); the fix plus a regression test went in before publish.

### React static analysis — React Doctor (`millionco/react-doctor`)

An Oxlint-based AST scanner with roughly 250 React rules spanning architecture, state-and-effects, performance, accessibility, and correctness, catching classes of bug that `eslint-plugin-react-hooks` does not, such as inline `<Provider value={{...}}>` literals. The frontend exposes two npm scripts: `npm run lint:react` (full-codebase informational scan, never fails CI) and `npm run lint:react:diff` (the pre-push gate, which scans files changed versus `main` and fails only on a newly introduced error). Known gap: it cannot catch a `useContext` of a churning provider inside a list-rendered component; no public linter does, so that one stays a human-review rule.

### Pre-push secret / hygiene greps

A 12-step checklist runs before every push to the public repo (it lives in full in `CLAUDE.md`). Greps 1 through 10 hunt the leak classes a public flip makes permanent: secrets in unpushed commit diffs, personal `/Users/<name>/` paths, real session keys or cookies in test fixtures, AI-attribution lines across the whole unpushed batch, accidentally-tracked credential / cache / `.env` files, real email addresses, `~/.claude` paths in the PyPI sdist, non-loopback IP addresses, private-infrastructure URLs, and stray `TODO` / `FIXME` markers in user-facing code. Step 11 is the React Doctor diff-gate above; step 12 is the `/security-review` diff review above.

### Deep maintainability review — strict code-quality review

A `/strict-code-quality-review` skill runs an unusually strict, ambitious maintainability review of a branch's changes: abstraction quality, oversized files, spaghetti-condition growth, swallowed errors, weak test coverage, and lost seams, hunting "code judo" moves that delete whole categories of complexity rather than tidying locally. It is a review skill (it diagnoses and recommends; it does not edit code), and it is explicitly a maintainability pass, not a security audit; security is the job of the `security-guidance` plugin and `/security-review` above. It surfaced the regressions an earlier refactor's first round of fixes had shipped, and a second pass hardened the changes further.

## Supply-chain audits

A dated log of upstream supply-chain incidents that touched (or potentially touched) this project's dependency tree, and what we verified for each.

### 2026-05-20 — Dev-dependency CVE inventory (npm audit)

`npm audit` against `frontend/package-lock.json` flags 6 vulnerabilities (2 moderate, 4 high). **Production runtime is clean** — `npm audit --omit=dev` returns 0 vulnerabilities, and every reachable parent is in `devDependencies`:

| Package | Version | Severity | Parent (all in `devDependencies`) | Production bundle? |
|---|---|---|---|---|
| `brace-expansion` | 1.1.12 / 5.0.4 | moderate | `eslint`, `typescript-eslint` | no |
| `flatted` | 3.3.4 | high | `eslint` (`file-entry-cache`) | no |
| `picomatch` | 4.0.3 | high | `vite`, `vitest` | no (build-time only) |
| `postcss` | 8.5.8 | moderate | `vite` | no (CSS transformed at build, postcss itself not bundled) |
| `undici` | 7.22.0 | high | `jsdom` (via `vitest`) | no |

The fixes are all `npm audit fix`-able when contributors next bump tooling. No action gates the V1 public flip — none of these reach the shipped frontend bundle (`frontend/dist/`) or the PyPI wheel.

### 2026-05-16 — Mini Shai-Hulud worm (TanStack ecosystem)

**Incident.** On 2026-05-11, the Mini Shai-Hulud npm supply-chain worm (attributed by [StepSecurity](https://github.com/TanStack/router/issues/7383) to the threat group **TeamPCP**) compromised 42 packages across 84 versions in the `@tanstack/*` namespace, via a GitHub Actions cache-poisoning + OIDC-token-extraction attack chain. The payload was an ~80 KB obfuscated credential-stealer that targeted CI/CD tokens, cloud credentials, npm tokens, and SSH keys. Full advisory: [GHSA-g7cv-rxg3-hmpx](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx). TanStack's postmortem: <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>.

**Our exposure.** `frontend/package.json` declares two `@tanstack/*` direct dependencies. The resolved tree per `frontend/package-lock.json` is:

| Package | Resolved version | Family |
|---|---|---|
| `@tanstack/react-query` | 5.90.21 | `query*` |
| `@tanstack/query-core` | 5.90.20 | `query*` (transitive of `react-query`) |
| `@tanstack/react-virtual` | 3.13.19 | `virtual*` |
| `@tanstack/virtual-core` | 3.13.19 | `virtual*` (transitive of `react-virtual`) |

**Audit result: clean.** Verified 2026-05-16. Fourteen independent checks across the dependency tree, the on-disk install, the CI configuration, the source-control history, the shipped artifact, and the maintainer's machine:

*Dependency tree*

1. **None of our four resolved `@tanstack/*` versions appear in [GHSA-g7cv-rxg3-hmpx](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx).** The advisory covers the `router*`, `start*`, `history`, `eslint-plugin-*`, `vue-router*`, `solid-router*`, and adapter families in the 1.x version range. Our deps are in the `query*` and `virtual*` families at 5.x and 3.x respectively. The TanStack postmortem also lists the `query*`, `table*`, `form*`, `virtual*`, and `store` families as explicitly clean.
2. **`frontend/package-lock.json` mtime is 2026-03-20** — pinned 7+ weeks before the attack. `git log -- frontend/package-lock.json` shows zero commits in the 2026-05-10..2026-05-17 attack window.
3. **No other lockfile types are present.** No `yarn.lock`, `pnpm-lock.yaml`, or `npm-shrinkwrap.json` anywhere in the repo, so the resolved dependency tree is fully described by the single npm lockfile we audited.
4. **None of the other named-compromised packages from the broader incident are in our tree.** Verified absence of `@opensearch-project/opensearch`, `@uipath/apollo-core`, `@squawk/*`, `mistralai`, and `guardrails-ai` from `frontend/package-lock.json`.

*On-disk IoCs*

5. **Zero hits for IoC strings** anywhere in `frontend/node_modules/` or `frontend/dist/`. Scanned for: `shai-hulud`, `shai_hulud`, `sha1-hulud` (typo variant), `voicproducoes`, `79ac49eedf`, the `webhook[.]site/bb8ca5f6-4175-45d2-b042-fc9ebb8170b7` exfiltration endpoint, `trufflehog`, and `git-tanstack.com`.
6. **No malware-named files in `node_modules`.** `find frontend/node_modules` for `setup_bun.js`, `bun_environment.js`, and `router_init.js` returned zero hits.
7. **None of our installed `@tanstack/*` packages declare `postinstall` or `preinstall` scripts.** The only `*install` hooks anywhere in `frontend/node_modules/` are `msw` (Mock Service Worker — testing library, expected) and `esbuild` (build tool, expected).

*CI and source-control state*

8. **`.github/workflows/` contains three files**, all hand-authored by the maintainer: `cla.yml` (CLA Assistant), `release.yml` (PyPI Trusted Publishing), `test.yml` (tests). No `codeql_analysis.yml` (a known worm-planted vector). The only `npx`/network-touching commands in any workflow are `npx playwright install --with-deps chromium` and `npx playwright test --reporter=line` — vanilla Playwright CI.
9. **`git log --all --author="claude@users.noreply.github.com"`** returns zero matches across all refs (worm-typical author signature absent).

*Project-level persistence*

10. **No project-level persistence vectors.** `.vscode/tasks.json` does not exist. `.claude/` exists but contains only `settings.local.json` whose top-level keys are `["permissions"]` (no `hooks`, no IoC strings). Our `frontend/package.json` declares no `install` / `postinstall` / `preinstall` / `prepare` / `prepack` / `postpack` lifecycle scripts.

*Maintainer's machine*

11. **`~/.claude/settings.json` hooks block contains only legitimate, hand-authored entries:** a `Notification` hook that plays `/System/Library/Sounds/Submarine.aiff`, and a `Stop` hook that runs `~/.claude/hooks/notify-if-slow.sh`. No IoC strings in the file. The Stop-hook script is 253 bytes, mtime `2026-02-18` (3 months before the attack), plays a sound if Claude took >15s, no network calls, no shell exec, no destructive operations.
12. **`~/.vscode/tasks.json`** does not exist.
13. **No `gh-token-monitor` or `git-tanstack` processes running** (`ps -Ao pid,command`). No `git-tanstack.com` entry in `/etc/hosts`.
14. **No `Shai-Hulud` repository exists under the maintainer's GitHub account** (`gh repo list rpeck`) or under any account authenticated against the local `gh` CLI. The worm's signature exfiltration artifact is absent.

*Shipped artifact*

15. **The shipped `frontend/dist/assets/index-*.js` bundle** (971,735 bytes, built 2026-05-13) is clean per the IoC scan in (5).

**Reproducing this audit.** From the repo root:

```bash
# (A) Dependency tree
grep -E '"@tanstack/' frontend/package-lock.json
ls frontend/yarn.lock frontend/pnpm-lock.yaml frontend/npm-shrinkwrap.json \
   yarn.lock pnpm-lock.yaml npm-shrinkwrap.json 2>/dev/null \
   || echo "Clean: npm lockfile only"
grep -E '"@opensearch-project/opensearch"|"@uipath/apollo-core"|"@squawk/|"mistralai"|"guardrails-ai"' \
  frontend/package-lock.json
# Cross-reference our @tanstack versions against:
#   https://github.com/advisories/GHSA-g7cv-rxg3-hmpx

# (B) On-disk IoCs
grep -rln -i "shai.hulud\|shai_hulud\|sha1-hulud\|voicproducoes\|79ac49eedf\|webhook\.site/bb8ca5f6\|trufflehog\|git-tanstack\.com" \
  frontend/node_modules frontend/dist
find frontend/node_modules -type f \
  \( -name "setup_bun.js" -o -name "bun_environment.js" -o -name "router_init.js" \)
find frontend/node_modules -maxdepth 4 -name package.json \
  | xargs grep -l '"postinstall"\|"preinstall"' 2>/dev/null
# Expected hits: only msw and esbuild for the postinstall scan; zero for everything else.

# (C) CI and source-control state
ls .github/workflows/
git log --all --author="claude@users.noreply.github.com" --oneline

# (D) Project-level persistence
ls .vscode/tasks.json .claude/ 2>&1
python3 -c "import json; print(json.load(open('frontend/package.json'))['scripts'])"

# (E) Maintainer-machine persistence
python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); print(json.dumps(d.get('hooks', {}), indent=2))"
grep -iE "shai|hulud|gh-token-monitor|webhook\.site|trufflehog|voicproducoes|git-tanstack" \
  ~/.claude/settings.json
ls ~/.vscode/tasks.json 2>&1
ps -Ao pid,command | grep -iE "gh-token-monitor|git-tanstack" | grep -v grep
grep -i "git-tanstack\|tanstack" /etc/hosts
gh repo list rpeck --limit 200 | grep -i "shai\|hulud" \
  || echo "Clean: no Shai-Hulud repo"
```

**What this audit does NOT cover.** The audit reasons strictly about the contents of this repository plus the maintainer's local Claude / VSCode configuration. It cannot rule out:

- Other machines that share npm tokens, GitHub tokens, or SSH keys with this one (a teammate's box, a CI runner with cached credentials, a personal work laptop). If any of those installed a poisoned package, the credentials they stole could in principle be used against this repo's GitHub remote later. Mitigation lives at those machines, not here.
- Future drift: a later `npm install` against the lockfile is safe by construction (the lockfile pins exact versions), but an `npm update` or a manual edit to `package.json` followed by a re-lock could pull in compromised versions that were not yet in the GHSA at audit time. Re-run this audit before any future lockfile bump.

Some claims in widely-shared social-media triage prompts about this worm (cumulative-downloads-as-infection-count, a tripwire `rm -rf ~/` payload) lack a primary technical source. None of that changes the audit conclusion (we are clean), but treat the GHSA advisory and the TanStack postmortem as the load-bearing references, and tertiary social posts as triage prose.
