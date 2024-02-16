## Usage

## Starting the build server

### `npm run dev`

This runs the build server using port 3000. The build server will call the application's API at port 3001 so you have to start the application using port 3001.

You can configure the port numbers to your liking if you want.

## Building the application

### `npm run build`

Builds the app for production to the `dist` folder.
It will optimise the application and minify all source code.

### `npm run buildwatch`

When running buildwatch, the build server will build the application every time you make a change to a file. 

## Starting the application (after building)

### `node server.js --port [PORT]`

Open [http://localhost:[PORT]](http://localhost:3000) to view it in the browser.

## Starting the application in development mode

Supply the `--dev` flag when starting the application. <br>
<b>TODO</b>: explain why development mode exists. if it even needs to exist.

## Deployment <i>(TODO)</i>

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
