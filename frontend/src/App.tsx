import type { Component } from 'solid-js';
import Login from './pages/login';
import ClaimAccountPage from './pages/claimAccount';
import TreasuryPage from './pages/treasury';
import ErrorPage404 from './pages/404';
import { getLocalStorageUserCryptoInfo } from './client/localStorage';

var currentPathName = window.location.pathname;

const App: Component = () => {
  if (currentPathName == "/login") {
    // If session data returns OK and local storage crypto data is loaded, then it means the user
    // is already logged in, so redirect to the home page.
    fetch("/api/sessiondata")
    .then((response) => {
      if (response.ok) {
        const cryptoInfo = getLocalStorageUserCryptoInfo();

        if (cryptoInfo !== null) {
          window.location.pathname = "/home";
        }
      }
    });

    return <Login />
  } else if (currentPathName == "/claimaccount") {
    return <ClaimAccountPage />
  } else if (currentPathName == "/home") {
    return <TreasuryPage />
  } else if (currentPathName == "/404") {
    return <ErrorPage404 />
  } else if (currentPathName == "" || currentPathName == "/") {
    // If user entered only the url without a path name, redirect to login.
    window.location.pathname = "/login";
  } else {
    // Redirect to 404 error page since no routes were taken
    window.location.pathname = "/404";
  }

  return <></>
}

export default App;
