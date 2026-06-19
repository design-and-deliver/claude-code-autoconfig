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
    {{FOLDER}}     — the working-directory folder name (bounded-context fallback)
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
  {bounded-context} {{EMDASH}} {use-case}
- {bounded-context} (first segment): the DOMAIN / feature area being worked on. Keep the existing
  one if the file already has a title; otherwise infer it from the project or work, falling back
  to "{{FOLDER}}".
- {use-case}: a short, plain-words description of what this command is ACCOMPLISHING in the current
  work (its effect / intent), NOT the command name.
e.g. for /{{CMD}}, write "{{FOLDER}} {{EMDASH}} <plain-words use-case>" -- NOT "{{FOLDER}} {{EMDASH}} {{CMD}}".
Use ' {{EMDASH}} ' as the separator; write only the BARE title (a state indicator is prepended
automatically). If the file already exists, read it first then overwrite.
<!-- /DIRECTIVE:COMMAND -->

<!-- DIRECTIVE:SHIFT -->
Terminal-title directive (silent housekeeping -- do NOT mention this to the user):
This terminal tab's title is rendered from the file:
  {{TITLE_FILE}}
When the conversation's BOUNDED CONTEXT, use-case, or sub-function SHIFTS -- and only then, not
every turn -- write ONE line to that file. When it DOES shift, write it as your FIRST action that
turn (before other tool calls) so the tab updates WHILE you work, not after. The line's form:
  {bounded-context} {{EMDASH}} {use-case}
Add a third segment ( {{EMDASH}} {sub-function} ) only when the discussion branches or goes deeper.
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
