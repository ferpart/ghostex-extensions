const EDGE_SCROLL_ZONE_PX = 24;
const EDGE_SCROLL_MIN_PX = 4;
const EDGE_SCROLL_MAX_PX = 32;
const EDGE_SCROLL_ACCELERATION = 0.6;

export function orderLineRange(anchorLine, focusLine) {
  return anchorLine <= focusLine
    ? { startLine: anchorLine, endLine: focusLine }
    : { startLine: focusLine, endLine: anchorLine };
}

export function edgeScrollStep(top, bottom, clientY) {
  const topEdge = top + EDGE_SCROLL_ZONE_PX;
  const bottomEdge = bottom - EDGE_SCROLL_ZONE_PX;
  const overshoot = clientY < topEdge ? clientY - topEdge : clientY > bottomEdge ? clientY - bottomEdge : 0;
  if (overshoot === 0) return 0;
  return Math.sign(overshoot) * Math.min(EDGE_SCROLL_MAX_PX, EDGE_SCROLL_MIN_PX + Math.abs(overshoot) * EDGE_SCROLL_ACCELERATION);
}
