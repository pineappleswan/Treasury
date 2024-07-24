class WebSocketSyncManager {
  private webSocket: WebSocket;
  private socketIsOpen: boolean;
  private onMessageCallbacks: ((event: MessageEvent) => void)[];
  private onCloseCallbacks: (() => void)[];

  constructor() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const socketUrl = `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;

    console.log(`Web socket sync URL: ${socketUrl}`);

    this.onMessageCallbacks = [];
    this.onCloseCallbacks = [];
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

  /**
   * Adds a callback that accepts a `MessageEvent` as an argument.
   * It will be called when the web socket receives a message from the server.
   */
  addOnMessageCallback(callback: (event: MessageEvent) => void) {
    this.onMessageCallbacks.push(callback);
  }

  /**
   * Adds a callback that accepts no arguments.
   * It will be called when the web socket closes.
   */
  addOnCloseCallback(callback: () => void) {
    this.onCloseCallbacks.push(callback);
  }

  /**
   * Sends a sync file event to the web socket.
   * @param {string} handle - The handle of the file to sync. 
   */
  sendSyncFileEvent(handle: string) {
    this.webSocket.send(`syncFile|${handle}`);
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

    this.onMessageCallbacks.forEach(callback => callback(event));
  }
  
  private onclose(event: CloseEvent) {
    console.log(`Web socket sync closed. Code: ${event.code} Reason: ${event.reason} Was clean: ${event.wasClean}`);

    this.onCloseCallbacks.forEach(callback => callback());
    this.socketIsOpen = false;
  }

  private onerror() {
    console.log("Web socket sync closed due to error.");
    this.socketIsOpen = false;
  }
}

export {
  WebSocketSyncManager
}
