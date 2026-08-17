<!-- @description Compress the investigation just completed into exactly three lines: root cause, conclusion, and the fix still outstanding (if any). -->
<!-- @version 1 -->
<!-- @response success | Three labelled lines — **Root cause:**, **Conclusion:**, **Fix:** — and nothing else. -->
<!-- @response nothing-to-summarize | One line saying there is no investigation in this conversation to compress. -->
<!-- @example /gimme-one-liner | Collapse the debugging thread above into three lines -->

# Gimme One-Liner

Collapse whatever was just investigated in this conversation into **exactly three lines**.

This command exists because a finished investigation is usually reported at the length it
took to *conduct* — the false starts, the tools that disagreed, the evidence trail. That
narration is worth having while the work is live and worthless once it lands. This is the
landing form.

## Scope

The subject is **the most recent investigation, debugging thread, or diagnosis in this
conversation** — not the whole session, and not the last thing you happened to say. If the
conversation moved on to unrelated work after the investigation closed, the investigation is
still the subject.

You already know the answer. Do **not** re-run tools, re-read files, or re-verify to write
this — it is a compression of context you hold, not a fresh pass. The one exception: if you
are about to state something as fact that you never actually confirmed, check it or drop it.

## Output — exactly three lines

```
**Root cause:** <the mechanism, in one sentence>
**Conclusion:** <where it stands now, in one sentence>
**Fix:** <what remains to be done, in one sentence — or "None." >
```

Nothing before the first line, nothing after the last. No preamble, no heading, no recap,
no closing offer, no bullets, no table.

Rules per line:

- **Root cause** names the *mechanism*, not the symptom. "The log wrote `(complete)` before
  the result was known" is a mechanism; "beeps were silent" is a symptom. If the root cause
  was never actually established, say so plainly — `Root cause: not established; <what is
  known>` — rather than promoting the leading theory to a finding.
- **Conclusion** is the current state: fixed, fixed-and-tested, open, or won't-fix. Name the
  commit hash if there is one. This is where an outcome that contradicts an earlier claim in
  the conversation gets stated, briefly and without re-litigating it.
- **Fix** is what is still *outstanding*. If the work is done, this is `None.` — do not
  restate the fix that already landed, which belongs to Conclusion. Anything discovered along
  the way but deliberately not done goes here in a clause, not a paragraph.

One line means one sentence. A line that needs a semicolon to survive is acceptable; a line
that needs two sentences means the compression is not finished.

## Length

The three lines are the whole response, so this command's output stays in the console — it is
under any auto-render threshold by construction. Do not render it to a web page.
