<!--
  terminal-title.directive.md — the instruction text terminal-title.js injects into the
  model's context. THIS is the tunable "product" surface: reword it freely without touching
  the hook's logic.

  Token-lean delivery (v2): the full rulebook is injected ONCE per session (SessionStart,
  including resume/compact so a squeezed context re-learns it); every prompt gets only a
  short reminder, plus state-specific addenda the hook selects when they apply.

  Blocks below:
    RULES    — the full directive, injected at SessionStart (all sources)
    REMINDER — the per-prompt one-liner (every UserPromptSubmit)
    BASELINE — appended to REMINDER while no title file exists yet (first turn)
    COMMAND  — appended to REMINDER when the turn starts with a /slash-command
  terminal-title.js picks REMINDER (+BASELINE/+COMMAND as applicable), substitutes the
  tokens, and injects. SessionStart injects RULES.

  Tokens (substituted at runtime):
    {{TITLE_FILE}} — absolute path to this session's title file the model writes
    {{ASK_FILE}}   — absolute path to this session's one-shot {sid}.ask flag
    {{FOLDER}}     — the working-directory folder name (scope fallback)
    {{EMDASH}}     — the ' — ' segment separator
    {{CMD}}        — the slash-command name (COMMAND block only)
-->

<!-- DIRECTIVE:RULES -->
Terminal-title directive (silent housekeeping -- never mention it to the user). These rules
apply to EVERY turn of this session; per-prompt reminders are one-liners that point back here.

This terminal tab's title renders from the file:
  {{TITLE_FILE}}
Maintain it across the session:
- When the conversation's SCOPE, use-case, or sub-function SHIFTS -- and only then, not every
  turn -- overwrite the file with ONE line:  {scope} {{EMDASH}} {use-case}
  Write it as your FIRST action of that turn (before other tool calls) so the tab updates
  WHILE you work, not after. If the file exists, read it first, then overwrite.
- {scope}: the DESIGN SCOPE -- the feature area / subsystem under discussion (the WHERE; it
  changes rarely). INFER the specific subsystem from the prompt and the files in play (e.g.
  "journal modal", "title hooks"); use the bare repo name "{{FOLDER}}" only when the work is
  genuinely repo-wide -- it is a last resort.
- {use-case}: the GOAL at user-goal level -- an INFINITIVE (base-verb) goal phrase (verb +
  object), e.g. "Refine title taxonomy". Name the goal, not the mechanism. One goal only --
  never "and"-join two use cases.
- Add a third segment ( {{EMDASH}} {sub-function} ) only when the work goes a level deeper --
  a step beneath the user goal.
- Use ' {{EMDASH}} ' (space, em-dash, space) as the separator; keep segments short (a few
  words); write only the BARE title -- a state glyph is prepended automatically. This is a
  compass, not a log: change it rarely.
- If no title has been set yet, treat your first turn as the baseline: infer the title from
  that turn's prompt and write it immediately, even though nothing has "shifted".
- Slash-command turns: the command NAME is an implementation detail -- never put it in the
  title. Name the goal the command ACCOMPLISHES ("{{FOLDER}} {{EMDASH}} <verb the goal>",
  never "{{FOLDER}} {{EMDASH}} <command-name>").

Pending-question signal: when you END a turn on a question the user must answer before you
can proceed, do BOTH as near-final actions so the tab flips to the AWAITING half-circle
(instead of the idle asterisk):
  1. Write the flag file {{ASK_FILE}} (any short content, e.g. "1"). This is the RELIABLE
     trigger -- it is on disk before the turn ends, so it never misses on phrasing or timing.
     The flag is one-shot (consumed at turn end, auto-cleared next turn), so write it ONLY on
     a turn genuinely blocked on an answer -- but ALWAYS then, even when the closing question
     is wrapped in parens or is not the literal final character of the message.
  2. Phrase your FINAL line to end with a question mark ('?') -- the backup signal, and good
     UX. A single trailing parenthetical aside after the '?' is fine.
Make the closing question self-contained: answerable without re-reading the response above
it. Never signal for a rhetorical question or a recap.
<!-- /DIRECTIVE:RULES -->

<!-- DIRECTIVE:REMINDER -->
Terminal-title reminder (housekeeping -- never mention to the user; full rules were injected
at session start): if this turn SHIFTS the scope/use-case, FIRST action: overwrite
{{TITLE_FILE}} with "{scope} {{EMDASH}} {use-case}". If you END this turn blocked on a
question, write the flag file {{ASK_FILE}} and end your final line with '?'.
<!-- /DIRECTIVE:REMINDER -->

<!-- DIRECTIVE:BASELINE -->
No title is set yet -- treat THIS turn as the baseline: infer {scope} {{EMDASH}} {use-case}
from this prompt and the files in play, and write {{TITLE_FILE}} NOW (first action). Do not
default to the bare folder name "{{FOLDER}}" unless the work is genuinely repo-wide.
<!-- /DIRECTIVE:BASELINE -->

<!-- DIRECTIVE:COMMAND -->
This turn runs the /{{CMD}} slash command -- the command NAME is an implementation detail:
never put "{{CMD}}" in the title. If the scope shifted, name the goal the command
ACCOMPLISHES (e.g. "<area> {{EMDASH}} <verb the goal>").
<!-- /DIRECTIVE:COMMAND -->
