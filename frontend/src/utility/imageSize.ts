import { Vector2D } from "../client/clientEnumsAndTypes";

// Calculates the width and height used for the <img> component for an image and ensures they fit into a max width and height
function calculateImageConstrainedSize(sourceImageSize: Vector2D, sizeConstraints: Vector2D): Vector2D {
  let scaledWidth = sourceImageSize.x;
  let scaledHeight = sourceImageSize.y;

  if (scaledWidth > sizeConstraints.x) {
    const scaleFactor = sizeConstraints.x / scaledWidth;
    scaledWidth *= scaleFactor;
    scaledHeight *= scaleFactor;
  }

  if (scaledHeight > sizeConstraints.y) {
    const scaleFactor = sizeConstraints.y / scaledHeight;
    scaledWidth *= scaleFactor;
    scaledHeight *= scaleFactor;
  }

  return { x: scaledWidth, y: scaledHeight }
}

export {
  calculateImageConstrainedSize
}
