# The oracle: checking mocanvas against tldraw, in CI

mocanvas's own test suite checks mocanvas against what mocanvas's author
believed tldraw does. Nothing in it can check the belief. That is not a
theoretical gap: every behavioural divergence fixed on 2026-11-12 — nine
releases of them — was found by a consumer running the two libraries side by
side, and none by this repository.

The oracle closes it by asking tldraw instead.

```bash
pnpm --filter bench oracle                   # the gate CI runs
pnpm --filter bench oracle --probes=note-grow,zoom-to-fit
pnpm --filter bench oracle --headed          # watch the gestures happen
pnpm --filter bench oracle --update          # record new differences, then write the reasons
```

## How it works

`apps/bench/oracle/probes.mjs` holds the questions. A probe is one function,
serialised to source and evaluated in both pages, returning JSON:

```js
{
  id: "zoom-to-fit",
  title: "`zoomToFit`, by default and at stated insets",
  run: (editor, h, kit) => { /* … */ },
}
```

It closes over nothing, so both libraries get byte-identical code. What it
needs arrives as arguments: `editor` is whichever library that page mounted,
`h` is the shared helpers, and `kit` is `window.oracleKit` — each page's own
exports, so a probe can build a record in the spelling that library wants
(`kit.toRichText(…)`).

A probe with `steps` is a gesture: the driver performs them as real pointer and
keyboard events between `setup` and `run`. The camera is identity for these, so
page coordinates and viewport coordinates are the same number. `"$accel"` asks
for the platform accelerator — cmd on macOS, ctrl elsewhere — which matters
more than it looks: on macOS ctrl+click *is* a right click, so a probe holding
Control through a press tests nothing and leaves the modifier stuck for every
probe after it.

`apps/bench/scripts/oracle.mjs` runs both pages in one browser, compares, and
writes the full answer to `apps/bench/results/oracle.json`.

## What makes it fail

Only a difference that `apps/bench/oracle/divergences.json` does not account
for. Each entry names a probe and a path, and carries a reason:

```json
{
  "probe": "zoom-to-fit",
  "path": "defaultInset.*",
  "status": "open",
  "since": "2026-11-12",
  "reason": "The arithmetic is identical at every stated inset; the whole difference is the default — 256 here against tldraw's 128."
}
```

`status` is `accepted` (decided: mocanvas is right to differ) or `open` (seen,
not decided). Both keep the run green. An open one is printed in full on every
run, so the list cannot quietly turn into the plan.

Two other things fail the run, on purpose:

- an entry whose `reason` still says `TODO`, which is what `--update` writes;
- an entry that matches nothing, because a list of known divergences nobody
  prunes stops being a list of known divergences.

## Adding a probe

Ask a question whose answer is a number or a name, not a picture. The pixel
comparison in `scripts/bench.mjs` already covers how things look, and covers it
better than an assertion could — see `apps/bench/results/visible-differences.md`
for why a stroke's wobble is scored as a distance rather than an overlap.

Three habits, each of which was learned by getting it wrong on the first run:

- **Round what you return.** A probe reporting seventeen digits of a sub-pixel
  is a probe that fails on a Tuesday. `h.round` and `h.deep` are there for it.
- **Ask the page, not the call.** The two libraries do not agree on what an
  operation *returns* — `duplicateShapes` hands back new ids in one and `this`
  in the other — so `h.made(editor, fn)` reports what appeared on the page.
- **Normalise anything jittered.** Index keys are randomised, so a default
  line's handles are keyed `a25kM` one run and `a20dn` the next. Compare the
  handles in index order, or the probe disagrees with itself.

And split a question that has two answers in it. `zoom-to-fit` reports the fit
at a stated inset *and* at the default: with the inset stated the two libraries
agree to five decimals, which turns "the camera is wrong" into "the default
inset is 256 rather than 128" — one line instead of a hunt.

## The clean-room line

`apps/bench` is the one place allowed to depend on tldraw and drive it through
its public API (docs/CLEAN_ROOM.md, "The one exception"). The oracle *calls*
tldraw and reads what comes back. It does not read tldraw's source to work out
what an answer should be, and nothing it prints is copied into `packages/**`.

A divergence is a question, not an instruction. tldraw is the reference, not
the authority: `embed`'s default size differs because 720x500 is a better
default than 300x300, and that is a decision worth keeping — written down,
with the reason, where the next person can see it.
