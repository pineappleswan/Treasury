import { createSignal, createEffect } from "solid-js";
import Hls from "hls.js";

type VideoPlayerProps = {
  fileDecryptionKey: Uint8Array
};

function VideoPlayer(props: VideoPlayerProps) {
  const { fileDecryptionKey } = props;
  const [ videoElement, setVideoElement ] = createSignal(null);

  createEffect(() => {
    const video = videoElement();
    const videoSource = "/api/testvideo";

    console.log(`Using decryption key: ${fileDecryptionKey}`);

    function ProcessPlaylist(playlist: any) {
      return playlist;
    }

    function ProcessFragment(fragment: any) {
      const encBuffer = fragment;
      const encUint8View = new Uint8Array(encBuffer);

      // TODO: decrypt video data

      const decBuffer = new ArrayBuffer(encBuffer.byteLength);
      const decUint8View = new Uint8Array(decBuffer);
      decUint8View.set(encUint8View);

      console.log(`Reconstructed size: ${decBuffer.byteLength}`);

      return decBuffer;
    }

    // This function intercepts the m3u8 playlist that is downloaded
    class pLoaderModified extends Hls.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        var load = this.load.bind(this);
        this.load = function (context: any, config, callbacks) {
          if (context.type == "manifest") {
            var onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (response, stats, context) {
              response.data = ProcessPlaylist(response.data);
              onSuccess(response, stats, context, null); // TODO: added null argument because of typescript warning, if cause issue, then remove
            };
          }
          load(context, config, callbacks);
        };
      }
    }

    class fLoaderModified extends Hls.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        var load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
          var onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (response, stats, context) {
            response.data = ProcessFragment(response.data);
            onSuccess(response, stats, context, null);
          };
          load(context, config, callbacks);
        };
      }
    }

    let hls = new Hls({
      pLoader: pLoaderModified,
      fLoader: fLoaderModified
    });
    
    if (Hls.isSupported()) {
      hls.loadSource(videoSource);
      hls.attachMedia(video);
    } else {
      console.error("HLS not supported!");
    }
  });

  return (
    <div>
      <video ref={setVideoElement} controls></video>
    </div>
  )
}

export default VideoPlayer;
