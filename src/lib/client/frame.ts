/** 把一帧里的多次流式更新合成一次渲染。 */
export function createFrameBatcher(apply: () => void) {
  let frame = 0;
  return {
    push() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    },
    flush() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      apply();
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
