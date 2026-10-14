'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Set on `<html>` while a phone keyboard is open: its height, as a px length. Pad the end of the
 * page by it (`padding-bottom: calc(<your padding> + var(--keyboard-height, 0px))`) and the last
 * field can still be scrolled above the keyboard.
 */
export const KEYBOARD_HEIGHT_PROPERTY = '--keyboard-height';

export interface KeyboardClearanceOptions {
    /**
     * Where a focused field is placed: px from the top of the visible area to the field's top.
     * Leave room for a sticky header and for the field's label. A function is read at each focus,
     * so it can measure. Default 16.
     */
    offsetTop?: number | (() => number);
}

/** Keyboards animate in; if the visual viewport has not reported a resize by then, act anyway. */
const SETTLE_MS = 400;

const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select';

/**
 * The on-screen keyboard's height: the part of the layout viewport the visual viewport no longer
 * covers. Phones shrink the visual viewport under the keyboard and leave the layout viewport (and
 * everything `fixed` in it) where it is; a pinch-zoom shrinks it too, and is not a keyboard.
 */
function keyboardHeight(viewport: VisualViewport): number {
    if (Math.abs(viewport.scale - 1) > 0.01) return 0;
    return Math.max(0, Math.round(window.innerHeight - viewport.height));
}

/**
 * Keeps a form usable under a phone's keyboard. While a keyboard is open, `--keyboard-height` on
 * the root element is its height, so the page can pad its end by that much and every field,
 * including the last, can be scrolled above the keyboard. And whenever a field in `container`
 * takes focus, it is scrolled to `offsetTop` once the keyboard has settled — so the keyboard never
 * covers it and the fields after it are in view. Does nothing without a keyboard.
 */
export function useKeyboardClearance(container: RefObject<HTMLElement | null>, options: KeyboardClearanceOptions = {}): void {
    const { offsetTop = 16 } = options;

    useEffect(() => {
        const root = document.documentElement;
        const viewport = window.visualViewport;
        const element = container.current;
        if (!viewport || !element) return;

        let pending: HTMLElement | null = null;
        let settle: ReturnType<typeof setTimeout> | undefined;

        const place = () => {
            const field = pending;
            pending = null;
            clearTimeout(settle);
            if (!field || keyboardHeight(viewport) === 0 || document.activeElement !== field) return;
            const offset = typeof offsetTop === 'function' ? offsetTop() : offsetTop;
            const top = field.getBoundingClientRect().top - viewport.offsetTop - offset;
            if (Math.abs(top) > 1) window.scrollBy({ top, behavior: 'smooth' });
        };

        // Padding first, so the scroll that follows is never clamped short of its target
        const onResize = () => {
            const height = keyboardHeight(viewport);
            if (height > 0) root.style.setProperty(KEYBOARD_HEIGHT_PROPERTY, `${height}px`);
            else root.style.removeProperty(KEYBOARD_HEIGHT_PROPERTY);
            if (pending) place();
        };

        const onFocusIn = (event: FocusEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.matches(FIELD_SELECTOR)) return;
            pending = target;
            clearTimeout(settle);
            // A keyboard already up will not resize the viewport again; one opening will, within SETTLE_MS
            if (keyboardHeight(viewport) > 0) place();
            else settle = setTimeout(place, SETTLE_MS);
        };

        viewport.addEventListener('resize', onResize);
        element.addEventListener('focusin', onFocusIn);
        onResize();
        return () => {
            viewport.removeEventListener('resize', onResize);
            element.removeEventListener('focusin', onFocusIn);
            clearTimeout(settle);
            root.style.removeProperty(KEYBOARD_HEIGHT_PROPERTY);
        };
    }, [container, offsetTop]);
}
