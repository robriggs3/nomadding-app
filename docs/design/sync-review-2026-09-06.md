# Cross-device sync: read-only review, 2026-09-06

Backlog item from `_status/cityops.md` INBOX 3: "a sign-in-to-sync path exists
in the city menu; state unverified". This is the verification. No code was
changed by this review.

## Verdict

The mechanism is sound and it is well covered. Nothing here needs fixing.

- `decideSync(localIso, remoteIso)` is newest-wins with ties keeping local.
- Both ISO dialects are handled: the device writes `...000Z`, PostgREST returns
  `...+00:00`, and those are the same instant but not equal as strings, so
  every comparison goes through epoch milliseconds. Unparseable stamps are
  treated as "no timestamp" rather than as year zero, which is the difference
  between a safe pull and a silent overwrite.
- `planSync` reconciles the union of both sides, so a city that exists on only
  one of them is handled rather than ignored.
- Removals propagate through tombstones, and tombstones are adopted BEFORE the
  newer-wins pass, so a deleted city cannot arrive back looking like a new one
  from another device.
- A re-added city beats its own tombstone, which is the right way round.
- 96 test references to `syncKit`. This is one of the better tested parts of
  the product.

## The finding that matters, and it is not a bug in sync

Sync does exactly what it says. The hazard is what "newest" means.

On 2026-09-06 Rob pasted the schema example from PROMPT.md into Update data.
That example is a real one-item Batumi guide whose dates derive the id of his
real Batumi, so his local copy went from 58 places to 1. The server still held
the good 58. His local copy was NEWER.

Had the queued push fired, newest-wins would have replaced 58 good places with
1, correctly by its own rule and catastrophically in fact. The only reason the
data survived is that the push had not yet run when he was told to sign out.

Sync cannot fix this and should not try. It has no way to tell a deliberate
replace from an accidental one, and a rule that second-guessed the newest write
would break the case it exists for. The fix belongs one layer up, at the moment
the local write happens, which is what the replace warning does: it now names
what a replace would destroy before it destroys it.

## Two gaps worth a decision (not acted on)

1. **No history.** A city row is overwritten by the newest push, and there is
   no snapshot before a destructive write. Tonight's recovery worked because
   the server copy happened to be intact and readable; that was luck, not
   design. A single previous-version row per city would turn "lucky" into
   "recoverable" and is cheap: one extra column or one extra row.

2. **A signed-in device with bad local data is a loaded gun until it syncs.**
   The safe advice tonight was "sign out immediately", which is not something a
   traveler will think of. If a destructive local write is detected, the app
   could hold the push and ask, rather than queueing it and racing the user.

Neither is urgent. Both are cheaper than the incident they prevent.

## What was checked

`decideSync`, `planSync`, `applyPull`, `pullAll`, tombstone adoption ordering,
stamp normalisation, and the existing syncKit tests. Read only: no edits, no
writes to the database, no pushes.
