import base64js from "base64-js";
import { Vector2D } from "./vector";

async function getSaltFromServer(username: string) {
  let response = await fetch(`/api/accounts/${username}/salt`);
  const saltB64 = await response.text();
  
  return base64js.toByteArray(saltB64);
}

/** Returns a Vector2 as { x: window.screen.width, y: window.screen.height } */
function getScreenSize(): Vector2D {
  return { x: window.screen.width, y: window.screen.height };
}

function getWindowSize(): Vector2D {
  return { x: window.innerWidth, y: window.innerHeight };
}

export {
  getSaltFromServer,
  getScreenSize,
  getWindowSize
}
