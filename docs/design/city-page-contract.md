# What belongs in a city page, and what does not

Status: OPEN brainstorm. Rob and the cityops thread both append here. Nothing
in this file is built until it moves into a plan.

Started 2026-09-06 by Rob, during the Ohrid guide work.

## The organising question

A guide accumulates whatever the AI felt like writing. That is how a city page
ends up restating the traveler's own dietary preferences back at them, and how
the same country-level fact gets written four times in four cities and then
drifts. This file is the rule set for deciding where any given fact lives.

## The test we are converging on

Ask what makes the fact change:

- Changes when you **change city** -> city page.
- Changes when you **change person** -> profile, stored once, globally.
- Changes when you **change itinerary** -> trip surface, not any single city.
- Changes when you **change country, not city** -> see the open question about a
  country layer below. Today these get copied per city and drift.
- Is a **pair** of two of the above -> store neither, compute it. See currency.

## Rules agreed so far

### R1 (Rob, 2026-09-06): currency conversion is surfaced, not stored

If the city's currency differs from the traveler's default currency (USD for
Rob), always surface the conversion rate in the **header** of the city page, and
always put the worked examples in the **Info** section.

Thread note: this one is a good example of the "pair" case above. The city
currency is city-scoped, the home currency is profile-scoped, so the RATE
belongs to neither and must be computed at render time from the two. Storing a
baked rate in the city JSON is what makes a guide reopened three weeks later
quietly wrong.

Corollary proposed: any surfaced rate carries an **as-of date**. A stale rate
shown with confidence is worse than no rate, because the traveler acts on it.

### R2 (Rob, 2026-09-06): profile never appears in a city page

Traveler profile (interests, avoid list, dietary notes, factors) is stored
globally in the profile and nowhere else. A city page may show the RESULT of the
profile (which places got picked, why a pick matches) but must never restate the
profile itself back at the reader.

## Proposed, not yet agreed (cityops thread, 2026-09-06)

### P1. Everything perishable carries an as-of date

Rates, prices, opening hours and ratings all have a shelf life, and a guide is
re-read all week. Anything in this class should render with when it was checked.
This is also the honest fix for the fact that in-app AI answers from memory
today, while a web-searched answer is genuinely current: the guide can show
which it was.

### P2. Country-level facts should not be stored per city

Emergency number, plug type and voltage, tap-water safety, tipping norm, and
which ride-hail app actually works are usually country facts, not city facts.
Batumi and Yerevan are different countries; Ksamil and Tiranë are the same one,
and today the same sentence is written twice and can drift apart. Open question:
introduce a country layer, or accept duplication and add a consistency check.

### P3. City page carries the primitives that change how you plan the day

Strong candidates, all genuinely city or country scoped:

- Getting in from the airport: method and real cost.
- Which ride-hail app works (Bolt, not Uber, in most of Rob's cities).
- Opening-hours conventions: siesta, Sunday closures, what shuts on a holiday.
- Whether English is widely spoken, plus hello and thank you.
- SIM or eSIM: which carrier, what it costs.

These are small, and each one changes decisions on every other card.

### P4. Things that are trip-level, not city-level

- Schengen and visa day counting: a function of the whole itinerary, so it
  belongs to the trip surface. Putting it in a city page makes it wrong the
  moment the itinerary changes.
- Cross-city budget totals, for the same reason.
- Anything about the NEXT city. A city page describing where you go next is a
  duplication of the trip surface that will drift.

### P5. Never in a city page, at all

- Credentials of any kind. Structurally impossible today; keep it that way.
- The traveler's own profile text (R2).
- Booking payment status. Already the rule on the family share page; the same
  reasoning applies here.

### P6. Proximity is narrated, and it went missing (Rob, 2026-09-06)

Rob, on what the older freeform-markdown guides gave him and the current ones
do not:

> "this thing is 200m from this other thing, good to do both while you're
> there, and then hit this place nearby for dinner on your way back"
> "this is an hour away, so block off your morning and shift your work
> schedule to evening"

The thread had called this underivable because items carry no coordinates. That
was wrong about the thing Rob actually had. The old guides never computed
proximity; the MODEL narrated it, out of what it knows about the city, in
prose. That needs no coordinates at all. It needs an instruction and a field.

PROMPT.md today uses proximity only as a SELECTION rule ("near the
accommodation", "on the way to that day's activity"). The model weighs it,
picks accordingly, and then throws the reasoning away. The traveler never sees
why these two things were chosen together.

Two separable features, and they age differently:

**(a) Narrated proximity.** A prompt change. The model writes the relationship
into the item. Available immediately, and it is what Rob is asking for.

**(b) Computed proximity.** Optional `lat`/`lng` on items, so the app can
measure distance itself, group a day geographically, and stay correct after a
re-sort. A data-model change, and the only version that survives editing.

**The rule that decides how to write (a):** a narrated relationship dies the
moment the traveler re-sorts, and re-sorting is the documented habit. So the
model must state facts about PLACES, never facts about the PLAN:

| Fragile, dies on re-sort | Durable, survives it |
|---|---|
| "on your way back from the amphitheatre" | "200m from the amphitheatre" |
| "do this after the monastery, dinner nearby" | "10 min walk from the monastery; 3 dinner options within 300m" |
| "block off Tuesday morning" | "1 hour each way from the centre; needs a half day" |

Rob's own second example splits exactly along that line: "an hour away" is a
place fact and belongs on the item; "shift your work to evening" is a day-shape
statement, and the schema has nowhere to put it (see open question 5).

Cost note, since B1: a searched run already drifts off the long parts of this
contract (it stopped dating picks, and it invented section ids). Adding another
per-item requirement is not free. Prefer one short, bounded field over a
paragraph, and expect to check adherence rather than assume it.


## Open questions

1. Country layer (P2): new layer in the data model, or duplication plus a
   drift check?
2. Does the Info section become the home for every "about this place, not about
   a specific venue" fact, so the other sections stay purely venues?
3. When a fact is both city-scoped and perishable (a price), is the as-of date
   per item or per guide?
4. What is the minimum a city page can contain and still be useful on arrival
   day, before any research has run?

## Log

- 2026-09-06: opened by Rob with R1 (currency) and R2 (no profile in city page).
  Thread added the pair-computation note, the as-of corollary, and P1 to P5.
5. Day shape: "this one is an hour away, so give it a morning" is a fact
   about a DAY, not about an item, and there is no per-day note in the schema.
   Add one, fold it into the first item of the day, or leave it out?
6. If items gain `lat`/`lng` (P6b), does the spread group geographically, and
   does it re-group when the traveler moves something, or only on request?
- 2026-09-06: Rob raised proximity narration as a real loss from the older markdown guides. Added P6 and open questions 5 and 6. The thread had wrongly called it underivable; it was never computed, it was narrated.
