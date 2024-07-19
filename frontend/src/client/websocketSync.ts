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
  WebSocketSyncManager
}
