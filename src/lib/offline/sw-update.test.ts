import { describe, it, expect, vi } from "vitest";
import { watchControllerChange, type ControllerChangeTarget } from "./sw-update";

// Мини-двойник ServiceWorkerContainer: хранит слушателей controllerchange и умеет их «эмитить».
function makeTarget(controller: unknown): ControllerChangeTarget & { emit(): void; count(): number } {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    emit: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
}

describe("watchControllerChange", () => {
  it("перезагружает при смене контроллера, если контроллер уже был (обновление после деплоя)", () => {
    const target = makeTarget({});
    const reload = vi.fn();
    watchControllerChange(target, reload, () => false);
    target.emit();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("НЕ подписывается на первом визите (контроллера ещё нет — это не обновление)", () => {
    const target = makeTarget(null);
    const reload = vi.fn();
    watchControllerChange(target, reload, () => false);
    expect(target.count()).toBe(0);
    target.emit();
    expect(reload).not.toHaveBeenCalled();
  });

  it("не перезагружает дважды при повторном событии", () => {
    const target = makeTarget({});
    const reload = vi.fn();
    watchControllerChange(target, reload, () => false);
    target.emit();
    target.emit();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("на /login не перезагружает и не залипает (после ухода с /login reload сработает)", () => {
    const target = makeTarget({});
    const reload = vi.fn();
    let onLogin = true;
    watchControllerChange(target, reload, () => onLogin);
    target.emit(); // на /login — пропуск
    expect(reload).not.toHaveBeenCalled();
    onLogin = false;
    target.emit(); // ушли с логина — теперь перезагружаем
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("cleanup снимает слушателя", () => {
    const target = makeTarget({});
    const reload = vi.fn();
    const off = watchControllerChange(target, reload, () => false);
    off();
    expect(target.count()).toBe(0);
    target.emit();
    expect(reload).not.toHaveBeenCalled();
  });
});
