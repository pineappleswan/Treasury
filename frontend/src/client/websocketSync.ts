enum SyncEventType {
  NewFile = "newFile",
  DeleteFile = "deleteFile"
}

class WebSocketSyncManager {
  private webSocket: WebSocket;
  private onCloseCallback: () => void;
  private isOpen: boolean;

  constructor(onCloseCallback: () => void) {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const socketUrl = `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;

    console.log(`Web socket sync URL: ${socketUrl}`);

    this.onCloseCallback = onCloseCallback;
    this.isOpen = false;
    
    this.webSocket = new WebSocket(socketUrl);
    this.webSocket.onopen = this.onopen.bind(this);
    this.webSocket.onmessage = this.onmessage.bind(this);
    this.webSocket.onclose = this.onclose.bind(this);
    this.webSocket.onerror = this.onerror.bind(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (!this.isOpen) {
      console.error("Trying to send data to web socket but it's closed!");
    }

    this.webSocket.send(data);
  }

  private onopen() {
    console.log("Web socket sync connection opened.");
    this.isOpen = true;
  }
  
  private onmessage(event: MessageEvent) {
    console.log(`Sync: ${event.data}`);
  }
  
  private onclose(event: CloseEvent) {
    console.log(`Web socket sync closed. Code: ${event.code} Reason: ${event.reason} Was clean: ${event.wasClean}`);
    this.onCloseCallback();
    this.isOpen = false;
  }

  private onerror() {
    console.log("Web socket sync closed due to error.");
    this.isOpen = false;
  }
}

export {
  SyncEventType,
  WebSocketSyncManager
}
