class Vector2D {
  x: number;
  y: number;
  
  static zero: Vector2D = { x: 0, y: 0 };

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function isVec2Equal(a: Vector2D, b: Vector2D): boolean {
  return a.x == b.x && a.y == b.y;
}

function isPointInsideDOMRect(point: Vector2D, rect: DOMRect): boolean {
  return (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

function isPointInsideBounds(point: Vector2D, topLeft: Vector2D, boundSize: Vector2D): boolean {
  return (
    point.x >= topLeft.x && point.x <= topLeft.x + boundSize.x && 
    point.y >= topLeft.y && point.y <= topLeft.y + boundSize.y
  );
}

function vec2Add(a: Vector2D, b: Vector2D): Vector2D {
  return {
    x: a.x + b.x,
    y: a.y + b.y
  }
}

function vec2Subtract(a: Vector2D, b: Vector2D): Vector2D {
  return {
    x: a.x - b.x,
    y: a.y - b.y
  }
}

function getVec2Distance(a: Vector2D, b: Vector2D) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/**
 * Returns a modified `topLeft` that keeps a rect of size `rectSize` within the bounds `min` and `max`.
 * `min` can be treated as the top left corner and `max` the bottom right corner of a boundary rect.
 */
function keepRectInBounds(topLeft: Vector2D, rectSize: Vector2D, min: Vector2D, max: Vector2D): Vector2D {
  const maxTopLeft: Vector2D = {
    x: max.x - rectSize.x,
    y: max.y - rectSize.y
  };

  return {
    x: Math.min(Math.max(topLeft.x, min.x), maxTopLeft.x),
    y: Math.min(Math.max(topLeft.y, min.y), maxTopLeft.y)
  };
}

function getTouchPos(touch: Touch): Vector2D {
  return { x: touch.clientX, y: touch.clientY };
}

export {
  Vector2D,
  isVec2Equal,
  isPointInsideDOMRect,
  isPointInsideBounds,
  vec2Subtract,
  vec2Add,
  getVec2Distance,
  keepRectInBounds,
  getTouchPos
}
