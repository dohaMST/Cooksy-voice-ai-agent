import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodePCM } from "./speak.ts";

function int16(...values: number[]) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** Rounds samples back to the int16 they came from, so assertions read as audio. */
function asInt16(samples: Float32Array) {
  return [...samples].map((sample) => Math.round(sample * 32768));
}

describe("decodePCM", () => {
  it("turns little-endian int16 into samples", () => {
    const { samples, pending } = decodePCM(new Uint8Array(0), int16(0, 16384, -32768, 32767));
    assert.deepEqual(asInt16(samples), [0, 16384, -32768, 32767]);
    assert.equal(pending.length, 0);
  });

  it("carries an odd trailing byte into the next chunk", () => {
    const whole = int16(1000, -1000);
    const first = decodePCM(new Uint8Array(0), whole.slice(0, 3));
    assert.equal(first.samples.length, 1);
    assert.equal(first.pending.length, 1);

    const second = decodePCM(first.pending, whole.slice(3));
    assert.deepEqual(asInt16(second.samples), [-1000]);
    assert.equal(second.pending.length, 0);
  });

  it("returns no samples for a chunk shorter than one sample", () => {
    const { samples, pending } = decodePCM(new Uint8Array(0), new Uint8Array([7]));
    assert.equal(samples.length, 0);
    assert.equal(pending.length, 1);
  });
});
