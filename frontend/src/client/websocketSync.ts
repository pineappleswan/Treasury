import { getEncryptedFileSize } from "../utility/commonUtils";
import { getFileCategoryFromFileName } from "./fileTypes";
import { FilesystemEntry } from "./userFilesystem";
import base64js from "base64-js";

// TODO: tests for the two functions below (create filesystem entry, then parse it and check all values match)

function createNewFileEvent(fileEntry: FilesystemEntry): string {
  let str = "";
  str += fileEntry.handle + "|";
  str += fileEntry.parentHandle + "|";
  str += fileEntry.name + "|";
  str += fileEntry.size.toString() + "|";
  str += fileEntry.dateAdded.toString() + "|";
  str += base64js.fromByteArray(fileEntry.fileCryptKey) + "|";
  str += (fileEntry.isFolder ? "1" : "0");

  return str;
}

/**
 * Parses the string created from **createNewFileEvent()**
 * @param data The data string
 * @returns The parsed filesystem entry or null if it failed
 */
function parseNewFileEventString(data: string): FilesystemEntry | null {
  let parts = data.split("|");

  if (parts.length != 7)
    return null;

  let handle = parts[0];
  let parentHandle = parts[1];
  let name = parts[2];
  let size = parseInt(parts[3]);
  let dateAdded = parseInt(parts[4]);
  let fileCryptKey = base64js.toByteArray(parts[5]);
  let isFolder = (parts[6] == "1" ? true : false);

  const fileCategory = getFileCategoryFromFileName(name);

  return {
    handle: handle,
    parentHandle: parentHandle,
    name: name,
    size: size,
    encryptedFileSize: getEncryptedFileSize(size),
    category: fileCategory,
    dateAdded: dateAdded,
    fileCryptKey: fileCryptKey,
    isFolder: isFolder
  };
}

type WebSocketSyncCallbacks = {
  onMessageCallback: (event: MessageEvent) => void,
  onCloseCallback: () => void
}

class WebSocketSyncManager {
  private webSocket: WebSocket;
  private socketIsOpen: boolean;
  private onMessageCallback: (event: MessageEvent) => void;
  private onCloseCallback: () => void;

  constructor(callbacks: WebSocketSyncCallbacks) {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const socketUrl = `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;

    console.log(`Web socket sync URL: ${socketUrl}`);

    this.onMessageCallback = callbacks.onMessageCallback;
    this.onCloseCallback = callbacks.onCloseCallback;
    this.socketIsOpen = false;
    
    this.webSocket = new WebSocket(socketUrl);
    this.webSocket.onopen = this.onopen.bind(this);
    this.webSocket.onmessage = this.onmessage.bind(this);
    this.webSocket.onclose = this.onclose.bind(this);
    this.webSocket.onerror = this.onerror.bind(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (!this.socketIsOpen) {
      console.error("Trying to send data to web socket but it's closed!");
    }

    this.webSocket.send(data);
  }

  isOpen() {
    return this.socketIsOpen;
  }

  private onopen() {
    console.log("Web socket sync connection opened.");
    this.socketIsOpen = true;
  }
  
  private onmessage(event: MessageEvent) {
    if (!this.socketIsOpen) {
      console.warn("Received web socket message when socket is not supposed to be open!");
      return;
    }

    this.onMessageCallback(event);
  }
  
  private onclose(event: CloseEvent) {
    console.log(`Web socket sync closed. Code: ${event.code} Reason: ${event.reason} Was clean: ${event.wasClean}`);
    this.onCloseCallback();
    this.socketIsOpen = false;
  }

  private onerror() {
    console.log("Web socket sync closed due to error.");
    this.socketIsOpen = false;
  }
}

export type {
  WebSocketSyncCallbacks
}

export {
  WebSocketSyncManager,
  createNewFileEvent,
  parseNewFileEventString
}
