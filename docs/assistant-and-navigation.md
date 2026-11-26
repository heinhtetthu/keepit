# Assistant and navigation

## The assistant ("Ask Keepit")

The **Ask Keepit** button sits in the bottom-right corner. It opens a small chat:

* **Starter questions** are picked to match what you're allowed to see, for example *Overdue borrows*, *Warranties ending*, *Asset count* and *Renewals due*.
* Answers appear as chat bubbles, with three follow-up suggestions underneath.
* **New chat** (↺) clears the conversation. Nothing is stored after you close the tab.

### How answers are produced

1. **Built-in answers** (no AI, always available):
   * asset counts by status and type;
   * overdue borrows;
   * warranties ending in 60 days;
   * records expiring soon or overdue;
   * record counts;
   * how-to steps taken from the Guide.

   They only use data you're allowed to see.
2. **AI answers** (optional) are used when a system administrator has set up a provider (Settings → AI) and your access includes *AI assistant*. Only your messages and a short summary of assets and records are sent. AI replies are marked "Answered with AI".

The assistant is read-only. To act from an AI client, use the MCP server with an API token.

Code: `apps/web/src/components/AssistantChat.tsx`, `apps/api/app/api/v1/help.py`, `apps/api/app/services/assistant_answers.py`, `apps/api/app/services/guide.py`.

## Navigation

* **Sidebar groups:** Assets, People, Renewals, Insights. Collapse the sidebar to an icon rail with the top-left button.
* **Create** (or press **C** anywhere) adds any record type, an asset, a borrow, a repair, maintenance, an employee or a document.
* **Search** (⌘/Ctrl + K) covers records, assets, employees and documents. The clock icon opens recently viewed pages.
* **Phones:** a bottom tab bar (Home, Assets, Create, Records, More); dialogs open as bottom sheets.
* **Guide:** a two-pane topic reader with search and ← → keys.
* **Settings:** a grouped hub (Your account, Workspace, People, Assets) with a searchable overview.
