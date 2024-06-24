/**
 * An enum of the types of windows that can be opened in the GUI.
 */
enum WindowType {
  Uploads,
  Downloads,
  Filesystem,
  Shared,
  Trash,
  Settings
};

type Vector2D = {
  x: number;
  y: number;
}

export {
  WindowType
}

export type {
  Vector2D
}
