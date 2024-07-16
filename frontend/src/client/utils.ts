import base64js from "base64-js";

async function getSaltFromServer(username: string) {
  let response = await fetch(`/api/accounts/${username}/salt`);
  const saltB64 = await response.text();
  
  return base64js.toByteArray(saltB64);
}

export {
  getSaltFromServer
}
