import { expect } from "chai";
import { waitForIntegrationCommand } from "../src/modules/commandWait";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A stand-in for Zotero.Integration with its command bookkeeping, following
 * execCommand (integration.js:257-259 and 346-347): a command sets the promise
 * and currentDoc when it starts, and on finishing clears currentDoc and
 * currentWindow before resolving the promise.
 */
function fakeIntegration() {
  const integration: any = {
    currentDoc: false,
    currentWindow: false,
    currentCommandPromise: Promise.resolve(),
  };
  return {
    integration,
    start() {
      let finish!: () => void;
      integration.currentCommandPromise = new Promise<void>((resolve) => {
        finish = () => {
          integration.currentDoc = false;
          integration.currentWindow = false;
          resolve();
        };
      });
      integration.currentDoc = true;
      return finish;
    },
  };
}

const options = (timeoutMs = 2000) => ({ timeoutMs, pollMs: 10, delay });

describe("waiting for a running command (waitForIntegrationCommand)", function () {
  it("returns at once when no command is running", async function () {
    const { integration } = fakeIntegration();
    const start = Date.now();
    expect(await waitForIntegrationCommand(integration, options())).to.equal(
      "idle",
    );
    expect(Date.now() - start).to.be.below(50);
  });

  it("returns at once without Zotero.Integration", async function () {
    expect(await waitForIntegrationCommand(undefined, options())).to.equal(
      "idle",
    );
  });

  it("waits until the running command has finished", async function () {
    const fake = fakeIntegration();
    const finish = fake.start();
    let finished = false;
    setTimeout(() => {
      finished = true;
      finish();
    }, 100);
    const result = await waitForIntegrationCommand(fake.integration, options());
    expect(result).to.equal("idle");
    expect(finished).to.equal(true);
  });

  it("also waits for a command that starts as the first one ends", async function () {
    const fake = fakeIntegration();
    const finishFirst = fake.start();
    let finishSecond: (() => void) | undefined;
    setTimeout(() => {
      finishFirst();
      // Queued behind the first, as shouldAbortCommand lets a new command do.
      finishSecond = fake.start();
      setTimeout(() => finishSecond!(), 100);
    }, 50);
    const result = await waitForIntegrationCommand(fake.integration, options());
    expect(result).to.equal("idle");
    expect(finishSecond, "second command started").to.be.a("function");
    expect(fake.integration.currentDoc).to.equal(false);
  });

  it("does not wait while a dialog is open", async function () {
    const fake = fakeIntegration();
    fake.start();
    fake.integration.currentWindow = {};
    const start = Date.now();
    expect(
      await waitForIntegrationCommand(fake.integration, options()),
    ).to.equal("dialog");
    expect(Date.now() - start).to.be.below(50);
  });

  it("stops waiting when a dialog opens during the command", async function () {
    const fake = fakeIntegration();
    fake.start();
    setTimeout(() => {
      fake.integration.currentWindow = {};
    }, 50);
    expect(
      await waitForIntegrationCommand(fake.integration, options()),
    ).to.equal("dialog");
  });

  it("gives up after the time limit", async function () {
    const fake = fakeIntegration();
    fake.start();
    const start = Date.now();
    expect(
      await waitForIntegrationCommand(fake.integration, options(100)),
    ).to.equal("timeout");
    expect(Date.now() - start)
      .to.be.at.least(90)
      .and.below(1000);
  });
});
