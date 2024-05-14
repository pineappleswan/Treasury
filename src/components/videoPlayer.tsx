import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import Hls, { FragmentLoaderContext, LoaderCallbacks, LoaderConfiguration, LoaderResponse, LoaderStats } from "hls.js";
import { ClientDownloadManager, DownloadFileContext, DownloadFileMethod } from "../client/transfers";
import { getLocalStorageUserCryptoInfo } from "../client/localStorage";
import { FilesystemEntry } from "./fileExplorer";
import CONSTANTS from "../common/constants";
import { UserSettings } from "../client/userSettings";

type VideoPlayInfo = {
  videoFileEntry: FilesystemEntry;
  m3u8Optional?: string; // Only provided if a video was optimised for streaming
  videoBinaryOptional?: Uint8Array; // Only provided if a video is NOT optimised for streaming
}

type VideoPlayerPlayVideoFunction = (playInfo: VideoPlayInfo) => void;

type VideoPlayerContext = {
  playVideo?: VideoPlayerPlayVideoFunction;
}

type VideoPlayerProps = {
  context: VideoPlayerContext;
  errorMessageCallback: (message: string) => void; // The video player can show error messages to the user via this callback
  userSettings: Accessor<UserSettings>;
  controlsVisibleAccessor: Accessor<boolean>;
}

function VideoPlayer(props: VideoPlayerProps) {
  // Get user's local crypto info
  const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

  if (userLocalCryptoInfo == null) {
		throw new Error("userLocalCryptoInfo is null!");
	}
  
  // Download manager for downloading video data
  const downloadManager = new ClientDownloadManager();

  const { context, userSettings, controlsVisibleAccessor } = props;
  const [ videoElement, setVideoElement ] = createSignal<HTMLVideoElement | null>(null);
  const [ directVideoSourceLink, setDirectVideoSourceLink ] = createSignal<string | undefined>(undefined);
  let blobUrlCleanupList: string[] = [];
  let shouldCancelDownload = false;
  let currentDownloadingHandle = "";
  let currentHls: Hls | null = null;

  onCleanup(() => {
    currentDownloadingHandle = "";
    shouldCancelDownload = true;

    // Cleanup blob urls
    blobUrlCleanupList.forEach(url => URL.revokeObjectURL(url));
    blobUrlCleanupList = [];
  });

  context.playVideo = async (playInfo: VideoPlayInfo) => {
    // Get video element
    const videoHTMLElement = videoElement();
  
    if (videoHTMLElement == null) {
      console.error("Video element for video player is null!");
      props.errorMessageCallback(`INTERNAL ERROR: video element is null!`);
      return;
    }

    // Destroy any old instance of Hls.js
    if (currentHls) {
      currentHls.destroy();
      currentHls = null;
    }
    
    // Set document's title to be the video file's name if user setting is set for that
    
    document.title = playInfo.videoFileEntry.name;

    currentDownloadingHandle = playInfo.videoFileEntry.handle;

    if (playInfo.m3u8Optional) {
      if (!Hls.isSupported()) {
        props.errorMessageCallback("Hls video is not supported");
        return;
      }

      // Clear any direct video source links
      setDirectVideoSourceLink(undefined);

      // Object used for caching chunks so that they don't have to be redownloaded (TODO: custom class for caching to establish max memory usage!)
      const cachedChunks: { [chunkId: number]: Uint8Array } = {}; // TODO: use map instead!? just for fun?
      
      // Custom fragment loader for m3u8 playlists
      class fLoaderModified extends Hls.DefaultConfig.loader {
        load = async function (
          context: FragmentLoaderContext,
          config: LoaderConfiguration,
          callbacks: LoaderCallbacks<FragmentLoaderContext>)
        {
          // Calculate how many chunks are in the range and download them
          const chunkIdStart = Math.floor(context.rangeStart! / CONSTANTS.CHUNK_DATA_SIZE);
          const chunkIdEnd = Math.ceil(context.rangeEnd! / CONSTANTS.CHUNK_DATA_SIZE);

          // Allocate a buffer the size of the video segment requested
          const segmentData = new Uint8Array(context.rangeEnd! - context.rangeStart!);
          let segmentWriteOffset = 0;

          // console.log(`range: ${context.rangeStart} -> ${context.rangeEnd} size: ${context.rangeEnd! - context.rangeStart!}. segment data length: ${segmentData.byteLength}`);

          const shouldCancelVideoStreamCallback = () => {
            return shouldCancelDownload || currentDownloadingHandle != playInfo.videoFileEntry.handle;
          }

          for (let i = chunkIdStart; i < chunkIdEnd; i++) {
            // Download chunks if not already cached
            if (cachedChunks[i] == undefined) {
              const data = await downloadManager.downloadChunk(
                playInfo.videoFileEntry.handle,
                i,
                playInfo.videoFileEntry.fileCryptKey,
                shouldCancelVideoStreamCallback
              );

              // If cancelled, just return.
              if (data.wasCancelled) {
                return;
              }

              cachedChunks[i] = data.data!;
            }

            // Append chunk data to the segment data buffer
            const chunkStartOffset = i * CONSTANTS.CHUNK_DATA_SIZE;
            const sliceStart = Math.max(0, context.rangeStart! - chunkStartOffset);
            const sliceEnd = Math.min(CONSTANTS.CHUNK_DATA_SIZE, context.rangeEnd! - chunkStartOffset);
            const slicedData = cachedChunks[i].slice(sliceStart, sliceEnd);

            // console.log(`${i} = ${sliceStart} -> ${sliceEnd}`);

            segmentData.set(slicedData, segmentWriteOffset);
            segmentWriteOffset += slicedData.byteLength;
          }

          // console.log(`data len: ${segmentData.byteLength}`);

          // Create response with the data
          const response: LoaderResponse = {
            data: segmentData,
            url: ""
          };

          // Create some fake stats
          const stats: LoaderStats = {
            aborted: false,
            loaded: segmentData.byteLength,
            retry: 0,
            total: segmentData.byteLength,
            chunkCount: Object.keys(cachedChunks).length,
            bwEstimate: 0,
            loading: { first: 0, start: 0, end: 0 }, // I have no idea what the last three values are really for
            parsing: { start: 0, end: 0 },
            buffering: { first: 0, start: 0, end: 0 }
          };

          callbacks.onSuccess(response, stats, context, null);
        };
      }

      // Create new Hls instance
      currentHls = new Hls({
        // @ts-ignore
        fLoader: fLoaderModified
      });
      
      // Process Hls error messages
      let unsupportedCodecMessage = false;
      
      currentHls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          if (data.details == "bufferIncompatibleCodecsError") {
            props.errorMessageCallback("Unsupported video codec");
            unsupportedCodecMessage = true;
          }
          
          if (!unsupportedCodecMessage) {
            props.errorMessageCallback("Fatal video playback error");
            console.log(`Fatal video playback error: ${data.details}`);
          }
        }

        console.log(event, data);
      });
      
      // Convert m3u8 string to blob
      const m3u8Binary = new TextEncoder().encode(playInfo.m3u8Optional);
      const m3u8Blob = URL.createObjectURL(new Blob([ m3u8Binary ]));

      // Add to cleanup list
      blobUrlCleanupList.push(m3u8Blob);

      // Attach video element
      currentHls.attachMedia(videoHTMLElement);
      
      // Load the blob
      currentHls.loadSource(m3u8Blob);
    } else {
      if (playInfo.videoBinaryOptional == undefined) {
        console.error("videoBinaryOptional is undefined! m3u8 not provided so video binary MUST be provided!");
        props.errorMessageCallback("INTERNAL ERROR");
      }

      // Convert to blob
      const videoBlob = URL.createObjectURL(new Blob([ playInfo.videoBinaryOptional! ]));

      // Add to cleanup list
      blobUrlCleanupList.push(videoBlob);

      // Set the video source link
      setDirectVideoSourceLink(videoBlob);
    }

    // Set default volume
    const videoHtmlElement = videoElement();

    if (videoHtmlElement) {
      videoHtmlElement.volume = userSettings().defaultMediaViewerVolume;
    } else {
      console.error("videoElement() is null! Can't set default volume.");
    }
  };

  return (
    <video
      class="min-w-[256] min-h-[144px] w-full h-full bg-black"
      style={`max-height: 100%;`}
      ref={setVideoElement}
      controls={controlsVisibleAccessor()}
      src={directVideoSourceLink()}
    ></video>
  )
}

export type {
  VideoPlayInfo,
  VideoPlayerPlayVideoFunction,
  VideoPlayerContext,
  VideoPlayerProps
}

export {
  VideoPlayer
};
