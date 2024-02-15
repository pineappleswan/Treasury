import Login from './pages/login';
import CreateAccountPage from './pages/createaccount';
import TreasuryPage from './pages/treasury';
import ErrorPage404 from './pages/404';

const isLogin = false;
var currentPathName = window.location.pathname;

// TODO: test without javascript

function App() {
  if (currentPathName == "/login") {
    return <Login />
  } else if (currentPathName == "/createaccount") {
    return <CreateAccountPage />
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
