# Skip /init — let Claude Code organically grow your CLAUDE.md

Every Claude Code setup guide says the same thing: run `/init`, let it generate your CLAUDE.md, customize from there.

I'm going to argue that's backwards for most projects.

## The problem with /init

`/init` scans your project and generates a CLAUDE.md describing your tech stack, build commands, project structure, and conventions. Sounds helpful. But consider what's actually happening:

Claude can already read your `package.json`, `tsconfig.json`, `.eslintrc`, your file tree, your framework configs. It knows you're running React with TypeScript. It knows your test command is `npm test`. It figured that out in milliseconds.

So what does a generated CLAUDE.md actually give you? A copy of information Claude already has — loaded into every single message, every session, forever.

## The real cost isn't tokens — it's dilution

Yes, CLAUDE.md loads into every message. Yes, that's wasted tokens. But the bigger problem is signal-to-noise ratio.

When your CLAUDE.md is 200 lines of project description, the 5 lines that genuinely matter — your team's non-obvious conventions, the deploy gotcha that burned you last month, the API endpoint that silently fails if called out of order — those get buried.

Claude weighs context. More noise means less attention on your actual rules. A bloated CLAUDE.md doesn't just waste space — it actively works against you.

## The alternative: start empty, work normally

For most projects — and nearly all greenfield ones — try this instead:

1. Don't run `/init`
2. Start with an empty CLAUDE.md (or no CLAUDE.md at all)
3. Work normally
4. When Claude gets something wrong, correct it in conversation
5. Claude updates CLAUDE.md itself with what it learned

That's it. No pre-configuration, no anxiety about what to include, no guessing what Claude might get wrong.

The file builds itself from real interactions. Every line is backed by an actual mistake that was corrected. Every entry earned its place.

## "But what about guardrails?"

The most common pushback: "What about dangerous mistakes? Don't I need to front-load rules to prevent Claude from breaking things?"

Claude already has strong safety instincts. It doesn't force-push to main. It doesn't delete your database. It asks before destructive operations. And your `settings.json` deny list handles the truly dangerous commands at the permissions level — enforced, not suggested.

For domain-specific footguns — non-obvious deploy flows, build modes with hidden side effects — you'll know because Claude will hit one. Correct it once, Claude adds the guardrail to CLAUDE.md, it never happens again.

Even the "pre-loaded guardrails" argument ends up being organic. You just discover them on a slightly different timeline.

## Who should still use /init?

This advice is an 80/20 take. If your project has exotic operational constraints — production deploy sequences that look like normal commands but silently break things, build modes with hidden side effects, cross-service auth flows that aren't documented in code — you may want to seed a few guardrails upfront.

But even then: start lean. A few critical rules, not a project description. Let the rest grow.

By default, skip the setup ritual. Go with the flow and be more productive.

## The mental model shift

CLAUDE.md is not documentation. It's not a project README for Claude. It's a **corrections file** — a living record of what Claude got wrong and learned from.

The best CLAUDE.md files I've seen weren't generated. They were grown. Every line has a story behind it: "Claude tried X, it broke Y, now it knows Z."

That's the file you want loading into every message.

---

*Try it: paste this article's thesis into a new Claude Code session and ask Claude what it thinks. See if your project is one where /init adds value or just adds noise. Form your own opinion.*
