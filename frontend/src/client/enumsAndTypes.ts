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

export {
  WindowType,
  isVec2Equal
}

export type {
  Vector2D
}
