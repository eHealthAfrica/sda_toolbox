import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// SDA Toolbox frontend — dev server config.
// The backend (FastAPI/uvicorn) is a separate process; set VITE_API_BASE_URL
// in .env to point at it (see .env.example). No proxy is configured here
// because the backend needs CORS enabled anyway for non-Vite consumers.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
    },
});
