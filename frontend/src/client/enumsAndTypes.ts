/**
 * An enum of the types of windows that can be opened in the GUI.
 */
enum WindowType {
  None = "None",
  Uploads = "Uploads",
  Downloads = "Downloads",
  Filesystem = "Filesystem",
  Shared = "Shared",
  Trash = "Trash",
  Settings = "Settings"
};

type Vector2D = {
  x: number;
  y: number;
}

function isVec2Equal(a: Vector2D, b: Vector2D) {
  return a.x == b.x && a.y == b.y;
}

function isPointInsideDOMRect(point: Vector2D, rect: DOMRect) {
  return (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

function isPointInsideBounds(point: Vector2D, topLeft: Vector2D, boundSize: Vector2D) {
  return (
    point.x >= topLeft.x && point.x <= topLeft.x + boundSize.x && 
    point.y >= topLeft.y && point.y <= topLeft.y + boundSize.y
  );
}

export {
  WindowType,
  isVec2Equal,
  isPointInsideDOMRect,
  isPointInsideBounds
}

export type {
  Vector2D
}
