// TODO: data caching functionality! for the case that so many tiny video chunks are in one file data chunk.

import { createSignal } from "solid-js";
import Hls from "hls.js";
import { ClientDownloadManager } from "../client/transfers";
import CONSTANTS from "../common/constants";

type VideoPlayerSettings = {
  watchVideo?: (videoFileHandle: string, m3u8: string, fileCryptKey: Uint8Array) => void
};

type VideoPlayerProps = {
  settings: VideoPlayerSettings
}

// TODO: TESTING ONLY
const bufferedChunks: { [chunkId: number]: Uint8Array } = {};

function VideoPlayer(props: VideoPlayerProps) {
  const { settings } = props;
  const [ videoElement, setVideoElement ] = createSignal<HTMLVideoElement | null>(null);
  const [ visible, setVisible ] = createSignal(false);

  settings.watchVideo = (videoFileHandle: string, m3u8: string, fileCryptKey: Uint8Array) => {
    console.log(`Watching ${videoFileHandle}`);

    // Convert m3u8 to blob
    const m3u8Binary = new TextEncoder().encode(m3u8);
    const m3u8Blob = URL.createObjectURL(new Blob([ m3u8Binary ]));

    const video = videoElement();
  
    if (video == null) {
      console.error("videoElement() is null!");
      return;
    }
  
    function ProcessPlaylist(playlist: any) {
      console.log(`playlist: ${playlist}`);
  
      return playlist;
    }
  
    function ProcessFragment(fragment: any) {
      const encBuffer = fragment;
      const encUint8View = new Uint8Array(encBuffer);
  
      // TODO: decrypt video data
  
      console.log(fragment);
  
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
              onSuccess(response, stats, context, null); // TODO: added null argument because of typescript warning, if it causes an issue, then remove it
            };
          }
          load(context, config, callbacks);
        };
      }
    }
  
    // Fragment loader
    class fLoaderModified extends Hls.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        var load = this.load.bind(this);
        this.load = async function (context, config, callbacks) {
          // Download chunk

          // TODO: if range is massive, calculate all chunks in between (test this with random values plz)
          const chunkId = Math.floor(context.rangeEnd! / CONSTANTS.CHUNK_DATA_SIZE);
          console.log(`chunk id: ${chunkId}`);

          console.log(`range: ${context.rangeStart} -> ${context.rangeEnd}`);
          
          const downloadManager = new ClientDownloadManager();
          let data = await downloadManager.downloadChunk(videoFileHandle, chunkId, fileCryptKey);

          // Store buffered chunk
          bufferedChunks[chunkId] = data;

          // Convert to blob URL
          const dataBlob = new Blob([ data ]);
          const dataBlobURL = URL.createObjectURL(dataBlob);

          // Set context url to be the downloaded blob
          context.url = dataBlobURL;
          
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
      fLoader: fLoaderModified,
    });
    
    if (Hls.isSupported()) {
      hls.loadSource(m3u8Blob);
      hls.attachMedia(video);
    } else {
      console.error("HLS not supported!");
    }
  };

  return (
    <div class={`${!visible() && "invisible;"}`}>
      <video ref={setVideoElement} controls></video>
    </div>
  )
}

export type {
  VideoPlayerSettings,
  VideoPlayerProps
}

export {
  VideoPlayer
};
