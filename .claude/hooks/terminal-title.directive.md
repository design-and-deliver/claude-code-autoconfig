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
- Plan-driven sessions: when the session executes a step of a multi-phase plan doc, the
  plan itself is the scope -- {scope} = a SHORT ALIAS of the plan's name (e.g.
  "Maintainability" for weak-model-maintainability-plan.md; never the filename), and the
  usual pair pushes down one level: {plan} {{EMDASH}} {area} {{EMDASH}} {goal}. The alias
  holds for the whole session; never add a fourth segment.
- Use ' {{EMDASH}} ' (space, em-dash, space) as the separator; keep segments short (a few
  words); write only the BARE title -- a state glyph is prepended automatically. This is a
  compass, not a log: change it rarely.
- If no title has been set yet, treat your first turn as the baseline: infer the title from
  that turn's prompt and write it immediately, even though nothing has "shifted".
- Slash-command turns: the command NAME is an implementation detail -- never put it in the
  title. Name the goal the command ACCOMPLISHES ("{{FOLDER}} {{EMDASH}} <verb the goal>",
  never "{{FOLDER}} {{EMDASH}} <command-name>").

Pending-question signal -- END-OF-TURN TEST, apply it on every turn: does your final
paragraph SOLICIT a reply from the user -- a question to answer, a decision to make, or a
go-ahead on a proposed next step (a fix you proposed, an offer to do more)? Grade the closer
by what it ASKS FOR, never by its punctuation -- a grammatical statement still solicits ("Say
the word if you'd rather keep the snapshots.") and answers YES to this test.
- YES and the ask is a CLOSED CHOICE -- yes/no, or 2-4 enumerable options (apply the fix?
  approve? pick an approach?) -> do NOT end the turn on a text question, NOR on its
  declarative twin ("Say the word if you'd rather X." / "Let me know which you prefer.") --
  the twin is the SAME closed ask wearing a period, and it belongs in the picker just as much:
  call the AskUserQuestion tool with those options instead. It renders a numbered picker; an "Other"
  free-text escape is auto-appended, so never add your own catch-all option. Its dialog
  paints the awaiting half-circle by itself -- no flag file, no '?' choreography. Act on
  the answer in the same turn; this end-of-turn test then re-applies to however the turn
  finally ends.
- YES with an OPEN-ENDED question (wording, direction, anything not enumerable) -> do ALL
  THREE as near-final actions so the tab flips to the AWAITING half-circle (instead of the
  idle asterisk):
  1. Phrase the solicitation as a DIRECT QUESTION. An offer IS a solicitation: write "Want
     me to apply both fixes?" -- never its declarative twin ("Say the word and I'll apply
     both fixes." / "I can also add tests if you want." / "Let me know."), which prompts the
     user back while hiding the awaiting signal.
  2. Write the flag file {{ASK_FILE}} (any short content, e.g. "1"). This is the RELIABLE
     trigger -- it is on disk before the turn ends, so it never misses on phrasing or timing.
     It is one-shot (consumed at turn end, auto-cleared next turn). Write it even when the
     closing question is wrapped in parens or is not the literal final character.
  3. Make '?' the LAST character of the message. Write NOTHING after the question -- no
     "Standing by.", "Ready when you are.", "Let me know." (a declarative sign-off defeats
     the signal). Only a single short parenthetical aside may follow the '?'. Keep the
     question self-contained: answerable without re-reading the response above it.
- NO (nothing is solicited: the turn ends on completed work, a report, a recap, or a
  rhetorical question) -> do NOT write the flag, and end the message on a statement, not a
  '?'. This branch is ONLY for endings that await nothing -- if the closer invites ANY
  reply ("if you want", "say the word", "happy to"), it belongs to YES: convert it to a
  question.
<!-- /DIRECTIVE:RULES -->

<!-- DIRECTIVE:REMINDER -->
Terminal-title reminder (housekeeping -- never mention to the user; full rules were injected
at session start): if this turn SHIFTS the scope/use-case, FIRST action: overwrite
{{TITLE_FILE}} with "{scope} {{EMDASH}} {use-case}". End-of-turn test: if your final
paragraph solicits a reply (a question, a decision, or a go-ahead on an offered next step):
never a declarative offer ("Say the word...") in EITHER branch -- a statement still
solicits: closed choice -> use AskUserQuestion; open-ended -> phrase it as a
DIRECT QUESTION, write the
flag file {{ASK_FILE}}, AND make '?' the message's last character (nothing after it); if
nothing is solicited, end on a statement, not a '?'.
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
