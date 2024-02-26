import { createSignal, createEffect } from "solid-js";
import Hls from "hls.js";

function VideoPlayer(props) {
  const { fileDecryptionKey } = props;
  const [ videoElement, setVideoElement ] = createSignal(null);

  createEffect(() => {
    const video = videoElement();
    const videoSource = "/api/testvideo";

    console.log(`Using decryption key: ${fileDecryptionKey}`);

    function ProcessPlaylist(playlist) {
      return playlist;
    }

    function ProcessFragment(fragment) {
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
    class pLoader extends Hls.DefaultConfig.loader {
      constructor(config) {
        super(config);
        var load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
          if (context.type == 'manifest') {
            var onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (response, stats, context) {
              response.data = ProcessPlaylist(response.data);
              onSuccess(response, stats, context);
            };
          }
          load(context, config, callbacks);
        };
      }
    }

    class fLoader extends Hls.DefaultConfig.loader {
      constructor(config) {
        super(config);
        var load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
          var onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (response, stats, context) {
            response.data = ProcessFragment(response.data);
            onSuccess(response, stats, context);
          };
          load(context, config, callbacks);
        };
      }
    }

    let hls = new Hls({
      pLoader: pLoader,
      fLoader: fLoader
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
