# Persistence And Sharing

## Save and load files

- **Save** exports the project as JSON.
- **Load** imports a previously saved JSON project.

Project JSON includes:

- pattern settings
- motif toggles
- palette and base color
- draw mapping configuration
- draw resume checkpoint state (`resumeState`, schema v2)

Version notes:

- Current payload format is `schemaVersion: 2`.
- Older payloads are still normalized on import.
- `inkscapeSvgCompatMode` is still accepted from legacy payloads as a deprecated no-op.

## Local storage

- **Store local** writes a named copy to browser localStorage.
- **Load local** restores the selected local project.
- **Delete** removes the selected local project entry.

## Share URL

- **Share** creates a URL with an embedded base64url project payload (`project=` parameter).
- Opening the link restores the design automatically.
- In schema v2, share links can also carry `resumeState` so interrupted draws can continue after reload.

Because the payload is embedded in the URL, avoid posting links publicly if they should stay private.
