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

export {
  WindowType
}

export type {
  Vector2D
}
