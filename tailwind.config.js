/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        "SpaceMono": ['"SpaceMono"'],
        "SpaceGrotesk": ['"SpaceGrotesk"'],
        "IBMPlexMono": ['"IBMPlexMono"']
      },
    }
  },
  plugins: [],
}

