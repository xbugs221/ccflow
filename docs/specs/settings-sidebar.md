# Settings and sidebar contract

## Requirements

### Keep only core settings tabs

The settings dialog exposes only appearance, agents, and diagnostics as top-level tabs.

- The settings dialog must show appearance, agents, and diagnostics.
- The settings dialog must not show global Git configuration.
- The settings dialog must not show API/token management.
- Requests for removed initial tabs such as `git` or `api` fall back to appearance.

### Keep appearance settings minimal

Appearance settings only cover user-facing presentation choices that remain supported.

- Appearance must include dark mode.
- Appearance must include language selection.
- Appearance must not include project sorting.
- Appearance must not include code editor theme, wrapping, minimap, line number, or font size controls.

### Remove global Git settings

ccflow does not manage global git identity from the settings UI.

- Settings must not render git name or git email forms.
- The old `/api/user/git-config` global git configuration capability must not remain available.
- Project-level Git panel and `/api/git` project routes remain available.

### Remove settings API and token management

Settings must not expose persistent external API key or GitHub token management.

- Settings must not render an API/token tab.
- Settings must not render API key create, delete, enable, disable, or copy controls.
- Settings must not render persistent GitHub token management.
- Removed settings API key routes and public API docs must not be published as current settings capabilities.
- One-time project creation GitHub token input remains independent from removed settings credentials.

### Keep agents focused on account status

The agents tab focuses on supported agent account and connection state.

- The agents tab must show Codex and OpenCode agent choices.
- The agents tab must not show MCP server subtabs or MCP server create, edit, or delete cards.
- Settings-specific Codex MCP form state and deleted category-tab props must not remain in the settings contract.

### Use an OpenCode-specific icon and provider status

OpenCode surfaces use their own icon and report the provider state returned by the backend.

- OpenCode must not reuse the Codex or ChatGPT logo resource.
- When the backend reports a connected provider such as `anthropic`, the OpenCode card shows that provider.
- When OpenCode CLI is available but no provider is connected, the card says no provider is connected.
- When OpenCode status checks fail, backend error text is shown before any available/no-provider copy.

### Localize diagnostics and supported languages

Diagnostics and language resources stay limited to supported locales.

- In Simplified Chinese, diagnostics title, description, status, success, failure, command path, home path, version, contract capabilities, PATH, loading, and error states must be localized.
- The language selector offers only English and Simplified Chinese.
- Saved `ja` or `ko` language preferences fall back to English at startup.
- Deleted Japanese and Korean locale resources must not be imported or initialized.

### Move sidebar tools to the footer

The expanded sidebar header is for product identity; project tools live in the footer.

- Desktop sidebar header shows brand/title only and no refresh, create project, project search, chat search, settings, or collapse buttons.
- Desktop sidebar footer shows refresh, create project, chat history search, settings, and collapse buttons.
- Mobile sidebar header shows brand/title only and no project action buttons.
- Mobile sidebar footer shows refresh, create project, chat history search, and settings, and respects safe-area padding.
- Project search button and project search input are removed.
- Collapsed sidebar must not show project search, while still allowing currently valid actions such as expand, chat history search, and settings.
