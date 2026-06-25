// The 17-flow inventory passed as the initial user message.
//
// Each flow has: a name (used in the report), a hint of what to do, and a
// one-sentence success criterion so Claude can self-grade. Order matters —
// each flow leaves the app in a state the next flow can build on.

export const FLOWS_BRIEF = `# Walkthrough — 17 flows, in order

Walk these in order. Each flow's success criterion is in **bold**. After each, append an entry to your internal flow log so you can emit the \`flows\` block at the end.

## 1. Cold-start brief
The app should be on the welcome screen with a question textarea. Type a real question — try: "What are the Warriors' realistic paths for the Porzingis 2026 expiring?" — and submit (⌘↵ or click "Start your first brief"). **Success: a generation placeholder appears, the welcome screen is gone, and within ~60s a recommendation card replaces the placeholder showing a thesis, paragraphs of reasoning, a "What I'm watching" section, and (when collapsed below) an "X scenarios" Strategic Options bar.**

## 2. Brief switching
Open ⌘N (or click the "+" in the brief tabs / the "New" button in the header). Submit a second question — try: "How much leverage do we have in Kuminga's RFA?" Then click between the two brief tabs. **Success: each tab shows its own thesis/options/sources; switching is instant; no state from one bleeds into the other.**

## 3. Chat follow-up
On the active (most recent) brief, click into the composer at the bottom and ask a follow-up — try: "What's our flexibility if Hield opts in?" **Success: the analyst's response streams in token-by-token, persists after switching tabs and switching back, and shows under your question.**

## 4. Cite chip hover + click
In the recommendation card body, find a \`[N]\` citation chip (small green square with a digit). Hover it → expect a popover with the source title + first few data rows. Click it → expect the LeftRail to scroll to and briefly highlight the matching source card. **Success: hover preview appears; click navigates the rail.**

## 5. Source kind tabs
At the top of the LeftRail, click each tab in turn: All / Contracts / Cap / Market / Picks. **Success: the count badge per tab matches the visible source cards; switching filters the list; "All" shows everything.**

## 6. Source drilldown from OptionsTable
Expand the Strategic Options table (click "Expand" or the chevron). On any row, click the "X src" pill on the right end. **Success: the LeftRail collapses to just sources whose ref_index matches that row, a "Filtered to ref [N]" chip appears with a Clear button, and clicking Clear restores the full list.**

## 7. Options table — Filter
With the Options table expanded, click "Filter" in the top-right. **Success: a popover with checkboxes for Executable / Plausible / Speculative appears; toggling them filters the rows in real time; the count in the header updates ("N of M scenarios"); a Clear button is available.**

## 8. Options table — Sort
Click "Sort" in the top-right. **Success: a popover with radio options appears (Cap impact desc/asc, Likelihood, Timing); selecting one re-orders the rows; the sort label is preserved when the popover closes.**

## 9. Options table — Export CSV
Click "Export". **Success: a CSV file downloads, named after the brief's thesis (e.g. \`re-sign-porzingis-...-options.csv\`).** You don't need to open the CSV — just verify the download triggered.

## 10. Bookmark
On the brief actions bar (just under the recommendation card), click the ☆ Bookmark. **Success: it flips to ★ Bookmarked; a "Saved" section appears at the top of the left rail with this brief listed.** Click again to unstar — verify it disappears from Saved.

## 11. Share + deep-link
Click "Share" in the brief actions. **Success: button label flips to "Link copied" briefly.** Then manually navigate to the URL by reloading the page — but first, in your URL bar, append \`?brief=<the-id-you-can-see-anywhere>\` (you don't actually need to read the id; instead just hit reload and verify the same brief is still active after refresh — that's the persistence half of the deep-link feature).

## 12. Watch this monitor
Click "Watch this" in the brief actions. **Success: a popover opens with a frequency chooser (Hourly / Daily / Weekly) and a "Create watch" button; clicking Create dismisses the popover and a success toast appears top-right.**

## 13. Re-run weekly
Click "Re-run weekly" in the brief actions. **Success: a success toast appears; the button label changes to "Weekly re-run on" and the button disables.**

## 14. Regenerate
Click "Regenerate" (right end of the brief actions bar). **Success: an info toast appears, the recommendation card disappears, the generation placeholder returns, and ~30–60s later a new (potentially different) recommendation card appears.** While generating, the brief tab shows a tiny green pulse.

## 15. Header search
Type a player name into the search box at the top — try "Porzingis" or "Kuminga". **Success: a dropdown appears with badged hits (BRIEF / CBA / SOURCE-kind); clicking a brief result switches to that brief.**

## 16. Sessions sidebar
Click the "Sessions" header in the left rail to expand it. **Success: a list of sessions appears; clicking a session label switches the active session and the brief tabs update accordingly.** Click "+ New" in the Sessions header to verify a session creator modal opens (you don't need to create one).

## 17. Empty session state
From the Sessions panel, click "+ New" → name it "QA test session" → submit. **Success: you land in a session with no briefs and see an "Ask the analyst" empty-state card with a CTA "Start your first brief →".** Clicking the CTA opens the brief creator modal. (You don't need to actually create another brief here.)

---

## When you're done

Emit the \`findings\` block, the \`flows\` block, and \`RUN_COMPLETE\` exactly as specified in the system prompt. If you finish all 17 flows in less than 30 minutes, that's fine — wrap up. If you hit 30 minutes and aren't done, wrap up anyway with what you have.

Begin by taking a screenshot to see where you are.`;
