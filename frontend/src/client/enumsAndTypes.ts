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

function isVec2InsideDOMRect(vec: Vector2D, rect: DOMRect) {
  if (vec.x >= rect.left && vec.x <= rect.right && vec.y >= rect.top && vec.y <= rect.bottom) {
    return true;
  } else {
    return false;
  }
}

export {
  WindowType,
  isVec2Equal,
  isVec2InsideDOMRect
}

export type {
  Vector2D
}
