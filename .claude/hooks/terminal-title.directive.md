<!--
  terminal-title.directive.md — the instruction terminal-title.js injects into the
  model's context on every prompt. THIS is the tunable "product" surface: reword it
  freely without touching the hook's logic.

  Blocks below:
    COMMAND — used when the turn starts with a /slash-command
    SHIFT   — used on a normal turn
    PENDING — appended to WHICHEVER of the above was selected (shared tail)
  terminal-title.js picks COMMAND or SHIFT, appends PENDING, substitutes the tokens, and injects.

  Tokens (substituted at runtime):
    {{TITLE_FILE}} — absolute path to this session's title file the model writes
    {{FOLDER}}     — the working-directory folder name (scope fallback)
    {{EMDASH}}     — the ' — ' segment separator
    {{CMD}}        — the slash-command name (COMMAND block only)
-->

<!-- DIRECTIVE:COMMAND -->
Terminal-title directive (silent housekeeping -- do NOT mention this to the user):
This terminal tab's title is rendered from the file:
  {{TITLE_FILE}}
You are running the /{{CMD}} slash command, but the command NAME is an implementation detail --
do NOT put "{{CMD}}" anywhere in the title. Write the title as your FIRST action this turn
(before other tool calls) so the tab updates WHILE you work, not after. Write ONE line of the form:
  {scope} {{EMDASH}} {use-case}
- {scope} (first segment): the DESIGN SCOPE -- the subject you are working inside: the feature area
  / subsystem (the boundary, the "system under discussion"). This is the WHERE, and it changes
  rarely. Keep the existing scope if the file already has a title; otherwise INFER the specific
  subsystem from THIS turn's prompt and the files in play (e.g. "journal modal", "title hooks",
  "auth flow"). Do NOT use the bare repo name "{{FOLDER}}" as the scope unless the work is genuinely
  repo-wide -- "{{FOLDER}}" is a last resort only when no narrower area is identifiable.
- {use-case} (second segment): the GOAL at user-goal level -- what this command ACCOMPLISHES, named
  as an INFINITIVE (base-verb) goal phrase (verb + object): "Review latest screenshot", "Diagnose
  pay discrepancy". Name the goal / effect, NOT the mechanism or the command name. One goal only --
  never "and"-join two use cases.
e.g. for /{{CMD}}, write "{{FOLDER}} {{EMDASH}} <verb the goal>" -- NOT "{{FOLDER}} {{EMDASH}} {{CMD}}".
Use ' {{EMDASH}} ' as the separator; write only the BARE title (a state indicator is prepended
automatically). If the file already exists, read it first then overwrite.
<!-- /DIRECTIVE:COMMAND -->

<!-- DIRECTIVE:SHIFT -->
Terminal-title directive (silent housekeeping -- do NOT mention this to the user):
This terminal tab's title is rendered from the file:
  {{TITLE_FILE}}
When the conversation's SCOPE, use-case, or sub-function SHIFTS -- and only then, not every turn --
write ONE line to that file. When it DOES shift, write it as your FIRST action that turn (before
other tool calls) so the tab updates WHILE you work, not after. The line's form:
  {scope} {{EMDASH}} {use-case}
- {scope}: the DESIGN SCOPE -- the subject under discussion: the feature area / subsystem (the
  boundary). This is the WHERE; it changes rarely. INFER the specific subsystem from the prompt and
  the files in play (e.g. "journal modal", "title hooks"); do NOT default to the bare repo name --
  use it only when the work is genuinely repo-wide.
- {use-case}: the GOAL at user-goal level -- what you are accomplishing, as an INFINITIVE (base-verb)
  goal phrase (verb + object), e.g. "Refine title taxonomy". Name the goal, not the
  mechanism. One goal only.
Add a third segment ( {{EMDASH}} {sub-function} ) only when the work goes a level deeper -- this is the
SUBFUNCTION goal level, a step beneath the user goal.
Rules: use ' {{EMDASH}} ' (space, em-dash, space) as the separator; keep each segment short (a few
words); write only the BARE title -- a state indicator is prepended automatically; leave the
file unchanged when the scope has not moved; this is a compass, so change it rarely. If the file
already exists, read it first then overwrite.
<!-- /DIRECTIVE:SHIFT -->

<!-- DIRECTIVE:PENDING -->
Pending-question signal: if you END this turn by asking the user a question they must answer
before you can proceed, phrase it so your FINAL line ends with a question mark ('?') -- the tab
indicator then flips to the AWAITING half-circle automatically (instead of the idle asterisk).
Make the closing question self-contained: answerable from the question alone, without re-reading
the response above it. Only end on a '?' for a genuine blocking question, never a rhetorical one.
<!-- /DIRECTIVE:PENDING -->
