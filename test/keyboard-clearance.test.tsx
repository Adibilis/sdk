// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { KEYBOARD_HEIGHT_PROPERTY, useKeyboardClearance, type KeyboardClearanceOptions } from '../src/checkout/keyboard-clearance';

/** jsdom has no visualViewport; this one is driven by hand, the way a phone drives the real one. */
class FakeViewport extends EventTarget {
    height = 800;
    offsetTop = 0;
    scale = 1;
    shrinkBy(keyboard: number) {
        this.height = 800 - keyboard;
        this.dispatchEvent(new Event('resize'));
    }
}

function Form({ options }: { options?: KeyboardClearanceOptions }) {
    const ref = useRef<HTMLDivElement>(null);
    useKeyboardClearance(ref, options);
    return (
        <div ref={ref}>
            <input aria-label="first" />
            <input aria-label="second" />
            <input type="checkbox" aria-label="tick" />
        </div>
    );
}

let viewport: FakeViewport;
const scrollBy = vi.fn();
const keyboardVar = () => document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_PROPERTY);

function focus(label: string, top: number) {
    const field = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    field.getBoundingClientRect = () => ({ top }) as DOMRect;
    act(() => {
        field.focus();
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    return field;
}

beforeEach(() => {
    vi.useFakeTimers();
    viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    scrollBy.mockReset();
});

// No vitest globals here, so Testing Library does not unmount between tests on its own; a Form
// left mounted would keep listening on the previous test's viewport and answer later queries.
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useKeyboardClearance', () => {
    it('does nothing without a keyboard: no padding, no scroll', () => {
        render(<Form />);
        focus('first', 400);
        act(() => vi.advanceTimersByTime(500));
        expect(keyboardVar()).toBe('');
        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('publishes the keyboard height while it is open, and clears it when it closes', () => {
        render(<Form />);
        act(() => viewport.shrinkBy(300));
        expect(keyboardVar()).toBe('300px');
        act(() => viewport.shrinkBy(0));
        expect(keyboardVar()).toBe('');
    });

    it('scrolls the focused field to offsetTop once the keyboard has opened', () => {
        render(<Form />);
        focus('first', 400);
        expect(scrollBy).not.toHaveBeenCalled(); // not before the keyboard is there
        act(() => viewport.shrinkBy(300));
        expect(scrollBy).toHaveBeenCalledWith({ top: 400 - 16, behavior: 'smooth' });
    });

    it('scrolls at once when the keyboard is already up', () => {
        render(<Form options={{ offsetTop: () => 100 }} />);
        act(() => viewport.shrinkBy(300));
        focus('second', 500);
        expect(scrollBy).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' });
    });

    it('accounts for a panned visual viewport', () => {
        render(<Form />);
        act(() => viewport.shrinkBy(300));
        viewport.offsetTop = 120;
        focus('first', 400);
        expect(scrollBy).toHaveBeenCalledWith({ top: 400 - 120 - 16, behavior: 'smooth' });
    });

    it('leaves a field alone that lost focus before the keyboard settled', () => {
        render(<Form />);
        const first = focus('first', 400);
        act(() => first.blur());
        act(() => viewport.shrinkBy(300));
        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('ignores checkboxes, and a pinch-zoom is not a keyboard', () => {
        render(<Form />);
        act(() => viewport.shrinkBy(300));
        focus('tick', 400);
        expect(scrollBy).not.toHaveBeenCalled();

        viewport.scale = 2;
        act(() => viewport.shrinkBy(400));
        expect(keyboardVar()).toBe('');
    });

    it('cleans up on unmount', () => {
        const { unmount } = render(<Form />);
        act(() => viewport.shrinkBy(300));
        expect(keyboardVar()).toBe('300px');
        unmount();
        expect(keyboardVar()).toBe('');
        act(() => viewport.shrinkBy(200));
        expect(keyboardVar()).toBe('');
    });
});
