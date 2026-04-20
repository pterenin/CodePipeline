import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildSleepPreventionArgs,
  detachSleepAssertionProcess,
  shouldPreventSleep
} from "../src/worker.js";

describe("shouldPreventSleep", () => {
  it("returns true only when enabled on macOS", () => {
    assert.equal(shouldPreventSleep(true, "darwin"), true);
    assert.equal(shouldPreventSleep(false, "darwin"), false);
    assert.equal(shouldPreventSleep(true, "linux"), false);
  });
});

describe("buildSleepPreventionArgs", () => {
  it("uses caffeinate -i so idle sleep is prevented on battery or AC power", () => {
    assert.deepEqual(buildSleepPreventionArgs(), ["-i"]);
  });
});

describe("detachSleepAssertionProcess", () => {
  it("returns a non-thenable wrapper around the execa child process", async () => {
    let caught = false;
    let killedWith: string | undefined;

    const wrapped = detachSleepAssertionProcess({
      exitCode: null,
      kill(signal?: string) {
        killedWith = signal;
        return true;
      },
      catch(onRejected?: (error: unknown) => unknown) {
        caught = true;
        return Promise.resolve(onRejected?.(new Error("ignored")));
      }
    });

    assert.equal("then" in wrapped, false);
    assert.equal(wrapped.kill("SIGTERM"), true);
    assert.equal(killedWith, "SIGTERM");
    await wrapped.catch(() => undefined);
    assert.equal(caught, true);
  });
});
