# AGENTS.md

## Project Overview
- This repository is the `eggbot-app` web application for generating and drawing Sorbian-style egg decorations.
- App code lives in `src/`; tests live in `tests/`.
- Browser entry uses `src/index.html` and `src/main.mjs`.
- Local server entry is `src/server.mjs`.
- PHP backend endpoint for shared hosting lives in `api/chat.php`.

## Key Files
- `src/main.mjs`
- `src/PatternGenerator.mjs`
- `src/EggScene.mjs`
- `src/EggBotSerial.mjs`
- `src/ProjectIoUtils.mjs`
- `src/ProjectUrlUtils.mjs`
- `src/index.html`
- `src/style.css`
- `README.md`

## Build, Run, Test
- Install: `npm install`
- Run: `npm start`
- Open: `http://localhost:3000/`
- Test: `npm test`

## Coding Style & Naming Conventions
- Prettier settings are in `.prettierrc.json`: 4-space indent, single quotes, no semicolons, no trailing commas.
- Keep files under 1000 lines; split modules when they approach this limit.
- Add JSDoc for every function/method, including private helpers.
- Add concise inline comments where behavior is non-obvious.
- Utility modules should prefer class-based organization with static helpers.
- For single-class modules, name the `.mjs` file in CamelCase to match the class name.
- Use ECMAScript private fields/methods for private internals.
- Use `async`/`await` for naturally asynchronous operations (serial I/O, fetch, file APIs).

## Testing Guidelines
- Use repo scripts (`npm test`) only.
- Add/update tests in `tests/` for new behavior.
- Keep tests focused on this app’s behavior and project utilities.

## Commit & Pull Request Guidelines
- Commit messages should start with prefixes like `feature:`, `fix:`, or `chore:` followed by a short imperative summary.
- Include affected areas and test results in merge request summaries.
- Attach screenshots for visible UI changes.

## Security & Configuration Tips
- Keep secrets out of Git; `.env` is ignored.
- Web Serial drawing requires HTTPS or `localhost` and explicit user gesture.
- Share links can embed project JSON; treat them as user-provided input and validate before applying.

## Skills
A skill is a set of local instructions stored in a `SKILL.md` file.

### Available Skills
- `find-skills`: Helps discover/install skills when users ask for capability extensions.
- `systematic-debugging`: Use when encountering bugs, test failures, or unexpected behavior before proposing fixes.
- `skill-creator`: Use when creating/updating a skill.
- `skill-installer`: Use when listing/installing skills.

### Skill Trigger Rules
- If the user names a skill (with `$SkillName` or plain text) or the request clearly matches a skill description, use that skill in that turn.
- If multiple skills apply, use the minimal set and state order briefly.
- If a skill cannot be loaded, state it briefly and continue with best fallback.

### Skill Usage Rules
- Read only enough from a skill to execute the task.
- Resolve relative paths from the skill directory first.
- Prefer referenced scripts/assets/templates over re-implementing large blocks.
- Keep context focused; avoid deep reference chasing unless blocked.
