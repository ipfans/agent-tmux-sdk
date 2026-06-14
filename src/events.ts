import { EventEmitter } from "node:events";

export type EventMap = Record<string, unknown[]>;

export class TypedEmitter<T extends EventMap> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean {
    return this.emitter.emit(event, ...args);
  }

  listenerCount<K extends keyof T & string>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners<K extends keyof T & string>(event?: K): this {
    if (event === undefined) {
      this.emitter.removeAllListeners();
    } else {
      this.emitter.removeAllListeners(event);
    }
    return this;
  }
}
