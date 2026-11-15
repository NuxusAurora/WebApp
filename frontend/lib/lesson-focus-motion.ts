const travelTime = 220;
const fadeTime = 130;
const settleTime = 230;
const ease = 'cubic-bezier(.2,.8,.2,1)';

export type LessonFocusOrigin = { top: number; height: number; partOffset: number };

export function findLessonQuestion(panel: HTMLElement | null, questionId?: string) {
  return Array.from(panel?.querySelectorAll<HTMLElement>('[data-lesson-question]') ?? [])
    .find(node => node.dataset.lessonQuestion === questionId);
}

function partRow(card: HTMLElement, number: number) {
  return card.querySelector(`[data-part="${number}"]`)?.closest<HTMLElement>('.lesson-problem-part');
}

function scrollTo(element: HTMLElement, target: number, duration: number, signal: AbortSignal) {
  const start = element.scrollTop;
  if (signal.aborted || Math.abs(target - start) < 1) return Promise.resolve();
  return new Promise<void>(resolve => {
    let frame = 0;
    let started: number | undefined;
    function stop() {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', stop);
      resolve();
    }
    function tick(now: number) {
      started ??= now;
      const t = Math.min(1, (now - started) / duration);
      element.scrollTop = start + (target - start) * (1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
      else stop();
    }
    frame = requestAnimationFrame(tick);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export function createLessonFocusMotion(panel: HTMLElement) {
  if (!panel.clientHeight || typeof panel.animate !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;

  const controller = new AbortController();
  const effects: Animation[] = [];
  function play(element: HTMLElement, keyframes: Keyframe[], duration: number, fill: FillMode = 'both') {
    const animation = element.animate(keyframes, { duration, easing: ease, fill });
    effects.push(animation);
    return animation.finished.catch(() => undefined);
  }
  function clearEffects() {
    for (const animation of effects.splice(0)) animation.cancel();
  }
  function cancel() {
    controller.abort();
    clearEffects();
  }
  return {
    cancel,
    async lift(slot: HTMLElement, number: number): Promise<LessonFocusOrigin | null> {
      const card = slot.querySelector<HTMLElement>('.lesson-problem-card');
      const part = card && partRow(card, number);
      if (!card || !part) return null;

      const padding = parseFloat(getComputedStyle(panel).getPropertyValue('--lesson-dock-top')) || 0;
      const desired = panel.scrollTop + card.getBoundingClientRect().top - panel.getBoundingClientRect().top - padding;
      const target = Math.max(0, Math.min(desired, panel.scrollHeight - panel.clientHeight));
      await scrollTo(panel, target, travelTime, controller.signal);
      if (controller.signal.aborted || !part.isConnected) return null;

      // Keep the source in the conversation until the surrounding material has faded.
      const viewport = panel.getBoundingClientRect();
      const otherQuestions = Array.from(panel.querySelectorAll<HTMLElement>('[data-lesson-question]'))
        .filter(node => node !== slot);
      const otherParts = Array.from(card.querySelectorAll<HTMLElement>('.lesson-problem-part'))
        .filter(node => node !== part);
      const oldHeader = card.querySelector<HTMLElement>('.lesson-problem-header');
      const leaving = oldHeader ? [...otherQuestions, ...otherParts, oldHeader] : [...otherQuestions, ...otherParts];
      const visible = leaving.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.top < viewport.bottom && rect.bottom > viewport.top;
      });
      await Promise.all(visible.map(node => play(node, [{ opacity: 1 }, { opacity: 0 }], fadeTime, 'forwards')));
      if (controller.signal.aborted || !part.isConnected) return null;

      const bounds = card.getBoundingClientRect();
      return { top: bounds.top, height: Math.min(bounds.height, viewport.bottom - bounds.top),
        partOffset: part.getBoundingClientRect().top - bounds.top };
    },
    async settle(dock: HTMLElement, number: number, origin: LessonFocusOrigin, explanation?: HTMLElement | null) {
      clearEffects();
      const card = dock.querySelector<HTMLElement>('.lesson-problem-card');
      const part = card && partRow(card, number);
      const body = card?.querySelector<HTMLElement>('.lesson-problem-text');
      if (!card || !part || !body || controller.signal.aborted) return;

      const targetScroll = body.scrollTop;
      body.scrollTop = 0;
      const bounds = card.getBoundingClientRect();
      const startHeight = Math.max(bounds.height, origin.height);
      const offset = origin.partOffset - (part.getBoundingClientRect().top - bounds.top);
      const header = card.querySelector<HTMLElement>('.lesson-problem-header');
      const arrivals = [
        play(card, [
          { height: `${startHeight}px`, maxHeight: `${startHeight}px`, transform: `translateY(${origin.top - bounds.top}px)` },
          { height: `${bounds.height}px`, maxHeight: `${bounds.height}px`, transform: 'translateY(0)' },
        ], settleTime),
        play(part, [
          { transform: `translateY(${offset}px)`, backgroundColor: 'transparent' },
          { transform: 'translateY(0)', backgroundColor: getComputedStyle(part).backgroundColor },
        ], settleTime),
        scrollTo(body, targetScroll, settleTime, controller.signal),
      ];
      if (header) arrivals.push(play(header, [{ opacity: 0 }, { opacity: 1 }], settleTime));
      if (explanation) arrivals.push(play(explanation, [{ opacity: 0 }, { opacity: 1 }], settleTime));
      await Promise.all(arrivals);
      if (!controller.signal.aborted) body.scrollTop = targetScroll;
      clearEffects();
    },
  };
}
