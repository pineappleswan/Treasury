import type { Component } from 'solid-js';
import Login from './pages/login';
import ClaimAccountPage from './pages/claimAccount';
import TreasuryPage from './pages/treasury';
import ErrorPage404 from './pages/404';

var currentPathName = window.location.pathname;

const App: Component = () => {
  if (currentPathName == "/login") {
    return <Login />
  } else if (currentPathName == "/claimaccount") {
    return <ClaimAccountPage />
  } else if (currentPathName == "/treasury") {
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
}

export default App;
