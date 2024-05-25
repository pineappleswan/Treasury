use tokio::fs::{File};
use std::{
	env, path::PathBuf
};

use axum::{
	http::{header, StatusCode},
	response::{IntoResponse, Response},
	routing::{get, post},
	Json, Router
};

use http::{Method};
use tower_http::cors::{Any, CorsLayer};

use tower_http::services::{
	ServeDir,
	ServeFile
};

#[tokio::main]
async fn main() {
	let address = "0.0.0.0";
	let port = 3001;

	// Print start message
	println!("Server listening on port {}", port);

	// Create the CORS layer
	let cors = CorsLayer::new()
		.allow_methods([ Method::GET, Method::POST ])
		.allow_origin(Any);

	// Start server
	let app = Router::new()
		.route_service("/", ServeFile::new("frontend/dist/index.html"))
		.route_service("/assets", ServeDir::new("frontend/dist/assets"))
		.layer(cors);

	let listener = tokio::net::TcpListener::bind(format!("{}:{}", address, port)).await.unwrap();
	axum::serve(listener, app).await.unwrap();
}
