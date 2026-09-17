/**
 * Waiting for a running word-processor command before the plugin shuts down.
 *
 * A module of its own, with no runtime imports, so it can be tested offline
 * against a fake Zotero.Integration (test-offline/commandWait.test.ts).
 *
 * WHY SHUTDOWN WAITS
 *
 * Nothing in Zotero ties a plugin's shutdown to a running Word command. When
 * this plugin is updated, disabled or removed, its patches come off at once --
 * and a Refresh already in progress carries on without them. Zotero yields
 * between citations (`await Zotero.Promise.delay()` in _updateCitations and
 * _updateDocument), so a Refresh of a long document spans real time, and every
 * citation serialized after the patches came off is written without its
 * narrative flag. Updates install in the background, at any moment.
 *
 * Zotero awaits a plugin's shutdown before it replaces the plugin's files
 * (Zotero.Plugins onInstalling, plugins.js:862, awaited by the add-on manager),
 * so the old version can hold its patches until the command finishes. That has
 * to be in the version being *replaced*: whatever this code does is what
 * protects the update away from it.
 *
 * WHEN IT DOES NOT WAIT
 *
 *  - A dialog is open (the citation dialog, Document Preferences, ...). The
 *    command is waiting for the user, possibly for hours, and holding shutdown
 *    that long would stall the update or leave the Plugins pane apparently
 *    stuck. During an update the new version is patched again well before
 *    anyone can press Accept.
 *  - After a time limit, for the same reason: a command can also wait on a
 *    prompt that is not a dialog window, such as "citation has been modified".
 *
 * Neither is a loss compared to not waiting at all.
 */

export type CommandWaitResult = "idle" | "dialog" | "timeout";

export interface CommandWaitOptions {
  /** Give up after this long. */
  timeoutMs: number;
  /** How often to re-check whether a dialog has opened meanwhile. */
  pollMs?: number;
  /** Zotero.Promise.delay inside Zotero; injectable for tests. */
  delay: (ms: number) => Promise<unknown>;
}

/**
 * Resolve once no word-processor command is running.
 *
 * Returns "idle" when none is (immediately, if none was), "dialog" when the
 * running command has a dialog open, and "timeout" when it is still running
 * after `timeoutMs`.
 *
 * Loops rather than awaiting one command: Zotero clears `currentDoc` and then
 * resolves `currentCommandPromise` (integration.js:346-347), and a command that
 * was queued behind the first can start before this resumes.
 */
export async function waitForIntegrationCommand(
  integration: any,
  { timeoutMs, pollMs = 500, delay }: CommandWaitOptions,
): Promise<CommandWaitResult> {
  const deadline = Date.now() + timeoutMs;
  while (integration?.currentDoc) {
    if (integration.currentWindow) return "dialog";
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "timeout";
    await Promise.race([
      integration.currentCommandPromise,
      delay(Math.min(remaining, pollMs)),
    ]);
  }
  return "idle";
}
