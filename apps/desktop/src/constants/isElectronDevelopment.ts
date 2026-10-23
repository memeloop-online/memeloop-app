// This constant is shared by main and renderer code. Keep it browser-safe:
// importing Electron here makes Vite bundle the npm electron launcher into
// lazy renderer chunks, where its Node-only __dirname access crashes.
export const isElectronDevelopment = process.env.NODE_ENV === 'development';
