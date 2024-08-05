import { createSignal, onCleanup } from "solid-js";
import { Vector2D } from "../client/vector";
import { calculateImageConstrainedSize } from "../utility/imageSize";
import { getWindowSize } from "../client/utils";

type ImageViewerOpenImageFunction = (imageBinaryData: Uint8Array) => Promise<void>;

type ImageViewerContext = {
  openImage?: ImageViewerOpenImageFunction;
}

type ImageViewerProps = {
  context: ImageViewerContext;
}

function ImageViewer(props: ImageViewerProps) {
  const [ imageSrc, setImageSrc ] = createSignal<string | undefined>();
  const [ srcImageSize, setSrcImageSize ] = createSignal<Vector2D>(Vector2D.zero);
  const [ renderImageSize, setRenderImageSize ] = createSignal<Vector2D>(Vector2D.zero);
  const imageBlobUrls: string[] = [];

  const updateSizes = () => {
    // Constrain the viewed image to the size of the window
    const windowSize = getWindowSize();
    const renderSize = calculateImageConstrainedSize(srcImageSize(), windowSize);
    setRenderImageSize(renderSize);
  };
  
  props.context.openImage = (imageBinaryData: Uint8Array) => {
    return new Promise<void>(async (resolve, reject: (reason: string) => void) => {    
      const imageBlob = new Blob([ imageBinaryData ]);
      const imageBlobUrl = URL.createObjectURL(imageBlob);
      
      // Get image size
      const image = new Image();
      
      image.onload = () => {
        setSrcImageSize({ x: image.width, y: image.height });
        setImageSrc(imageBlobUrl);
        updateSizes();
        resolve();
      };

      image.onerror = () => {
        setImageSrc(undefined); // Show blank screen
        reject("Failed to load image. Maybe the format is unsupported by your browser.");
      };

      imageBlobUrls.push(imageBlobUrl);
      image.src = imageBlobUrl;
    });
  }

  updateSizes();
  window.addEventListener("resize", updateSizes);

  onCleanup(() => {
    window.removeEventListener("resize", updateSizes);
    imageBlobUrls.forEach(url => URL.revokeObjectURL(url));
  });

  return (
    <div class="flex items-center justify-center w-full h-full">
      <img
        class={`${imageSrc() == undefined && "invisible"}`}
        src={imageSrc()}
        width={renderImageSize().x}
        height={renderImageSize().y}
      />
    </div>
  )
}

export type {
  ImageViewerOpenImageFunction,
  ImageViewerContext,
  ImageViewerProps
}

export {
  ImageViewer
}
