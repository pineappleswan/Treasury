# Treasury
Treasury is a free and open source end-to-end encrypted cloud storage app built using Typescript, SolidJS and Node.js with the goal of being lightweight, self-hostable and simple to use.
It has all the basic features of a cloud storage app that you'd expect and comes with a minimalistic user interface that is customiseable using themes.

> [!WARNING]
> This project is under heavy development and isn't mature yet. New versions of treasury may be buggy and/or break compatibility with previous versions.

## Features
* Photo and video viewer
* Themes
* Advanced file search
* Sharing files and folders between users and publicly through links
* Automatic image and video thumbnail generation
* Optimising mp4 video for streaming
* Mobile support
* EXIF metadata viewer

## Setup
You can host Treasury at home or use online services to host it for you.

## Creating new users
- TODO: newuser with gb and gib commands and distributing claim codes, etc.

## Cryptography
* Argon2id for password hashing and key derivation.
* XChaCha20-Poly1305 for encrypting files and file metadata.
* Ed25519 for signing files
