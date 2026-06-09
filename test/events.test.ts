import { describe, expect, it, vi } from "vitest";
import { TypedEmitter } from "../src/events.js";

type TestEvents = {
  hello: [name: string];
  count: [n: number, label: string];
  empty: [];
};

describe("TypedEmitter", () => {
  it("calls registered listeners with correct arguments", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("hello", listener);

    emitter.emit("hello", "world");

    expect(listener).toHaveBeenCalledWith("world");
  });

  it("supports multiple arguments", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("count", listener);

    emitter.emit("count", 42, "items");

    expect(listener).toHaveBeenCalledWith(42, "items");
  });

  it("removes a listener with off()", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("hello", listener);
    emitter.off("hello", listener);

    emitter.emit("hello", "world");

    expect(listener).not.toHaveBeenCalled();
  });

  it("fires once() listener exactly once", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.once("hello", listener);

    emitter.emit("hello", "first");
    emitter.emit("hello", "second");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("first");
  });

  it("returns false from emit() when no listeners are registered", () => {
    const emitter = new TypedEmitter<TestEvents>();

    expect(emitter.emit("hello", "nobody")).toBe(false);
  });

  it("returns true from emit() when listeners are registered", () => {
    const emitter = new TypedEmitter<TestEvents>();
    emitter.on("hello", () => {});

    expect(emitter.emit("hello", "someone")).toBe(true);
  });

  it("reports accurate listenerCount", () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(emitter.listenerCount("hello")).toBe(0);

    const a = () => {};
    const b = () => {};
    emitter.on("hello", a);
    emitter.on("hello", b);
    expect(emitter.listenerCount("hello")).toBe(2);

    emitter.off("hello", a);
    expect(emitter.listenerCount("hello")).toBe(1);
  });

  it("removeAllListeners() clears all subscriptions for an event", () => {
    const emitter = new TypedEmitter<TestEvents>();
    emitter.on("hello", () => {});
    emitter.on("hello", () => {});
    emitter.on("count", () => {});

    emitter.removeAllListeners("hello");

    expect(emitter.listenerCount("hello")).toBe(0);
    expect(emitter.listenerCount("count")).toBe(1);
  });

  it("removeAllListeners() without argument clears everything", () => {
    const emitter = new TypedEmitter<TestEvents>();
    emitter.on("hello", () => {});
    emitter.on("count", () => {});

    emitter.removeAllListeners();

    expect(emitter.listenerCount("hello")).toBe(0);
    expect(emitter.listenerCount("count")).toBe(0);
  });

  it("supports events with no arguments", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("empty", listener);

    emitter.emit("empty");

    expect(listener).toHaveBeenCalledWith();
  });

  it("supports method chaining", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = () => {};

    const result = emitter.on("hello", listener).off("hello", listener).removeAllListeners();

    expect(result).toBe(emitter);
  });
});
